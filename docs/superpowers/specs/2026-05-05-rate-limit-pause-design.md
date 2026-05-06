# Rate-Limit Pause Design

**Date:** 2026-05-05
**Status:** Approved (pending implementation plan)

---

## Goal

When an LLM call hits a rate limit, pause the writing process and resume automatically (HTTP providers) or on user signal (Claude CLI), rather than burning the bounded transient-retry budget and bubbling up to job-level retry.

The current `src/llm.js` retries 429s only 3 times with exponential backoff (~2s + 4s + 8s + jitter ≈ 14s max). Real per-minute / per-hour rate-limit windows outlast that, so today the job fails, gets job-level retried, and hits the same wall — wasting LLM tokens already consumed in the failed call. This feature replaces that with bounded-only-by-the-server pauses.

## Non-goals

- Configurable wait knobs (fallback duration, max cap, polling interval). Hard-coded for v1.
- Per-role pause behavior. A rate limit pauses any `callLLM` invocation regardless of which role triggered it.
- Job-level requeue. Brainstorming Q1 chose in-call wait. The job stays alive in memory; pipeline-stage artifacts already on disk are unaffected.
- Surfacing pause state in `duanju-writer jobs` output. Brainstorming Q4 chose log-only observability.
- Multi-provider concurrency. The codebase runs one `callLLM` at a time; no need for partial-pause logic.
- Cross-job awareness. If multiple jobs queued, a paused job blocks the daemon (consistent with `maxConcurrentJobs: 1`).

## Behavior summary

| Provider | Rate-limit detection | Pause behavior | Resume |
|---|---|---|---|
| OpenAI / OpenAI-compatible HTTP | HTTP 429 | sleep `Retry-After` (seconds) or `retry-after-ms` header value; 60_000 ms if missing/unparseable; no max cap | automatic |
| Claude CLI (subprocess) | stderr matches `/usage limit reached\|rate.?limit\|overloaded/i` | TTY: print prompt, block on stdin (Press Enter); non-TTY: poll for `~/.duanju-writer/resume.flag` every 30 s | manual: stdin Enter, or run `duanju-writer resume`, or `touch ~/.duanju-writer/resume.flag` |

Other transient errors (5xx, timeouts, ECONN*) keep the existing 3-attempt exponential-backoff path. Non-transient errors still throw immediately.

## CLI surface

### New subcommand: `duanju-writer resume`

Writes a sentinel file at `${DATA_DIR}/resume.flag` (where `DATA_DIR = ~/.duanju-writer`). One-shot; exits 0 on success.

```
$ duanju-writer resume
Resume signal written to /Users/<user>/.duanju-writer/resume.flag
```

The resume polling loop in `retryTransient` deletes the file as soon as it appears, so the signal is single-use. Re-running `resume` after the loop has already consumed the flag is a no-op (it just creates a fresh flag for the next pause).

### Help text update

`duanju-writer help`'s command list gets one new line:
```
duanju-writer resume         signal a paused worker to retry (Claude CLI rate-limit)
```

### No flags or config keys are added.

## Architecture

### New module-private classes in `src/llm.js`

```js
export class RateLimitError extends Error {
  constructor(retryAfterMs, providerInfo = '') {
    super(`LLM rate-limited; retry after ${retryAfterMs}ms${providerInfo ? ' (' + providerInfo + ')' : ''}`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class ClaudeCliRateLimitError extends Error {
  constructor(message = 'Claude CLI rate limit reached') {
    super(message);
    this.name = 'ClaudeCliRateLimitError';
  }
}
```

Both are exported (so tests can construct them). Neither has a `retryAfterMs` for the CLI variant — the wait is driven by user action, not a duration.

### OpenAI adapter changes (`src/llm.js`, current line ~38–95)

In the `if (!response.ok)` branch:

```js
if (response.status === 429) {
  const retryAfterMs = parseRetryAfter(
    response.headers.get('retry-after-ms'),
    response.headers.get('retry-after')
  );
  await response.text().catch(() => '');  // drain body
  throw new RateLimitError(retryAfterMs, baseUrl);
}
// existing path for non-429 unchanged
```

**Helper (pure, exported for unit testing):**

```js
export function parseRetryAfter(msHeader, secondsHeader) {
  // retry-after-ms (Anthropic-style) wins when present
  if (msHeader) {
    const ms = Number(msHeader);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (secondsHeader) {
    if (/^\d+$/.test(secondsHeader.trim())) {
      return Number(secondsHeader) * 1000;
    }
    // HTTP-date format (Wed, 21 Oct 2015 07:28:00 GMT)
    const t = Date.parse(secondsHeader);
    if (Number.isFinite(t)) {
      const ms = t - Date.now();
      if (ms > 0) return ms;
    }
  }
  return 60_000;  // 60s fallback
}
```

### Claude CLI adapter changes (`src/llm.js`, current line ~105+)

After the existing `execFile` catch block:

```js
} catch (err) {
  const text = (err?.stderr || '') + ' ' + (err?.message || '');
  if (/usage limit reached|rate.?limit|overloaded/i.test(text)) {
    throw new ClaudeCliRateLimitError(`Claude CLI rate limit reached: ${text.slice(0, 200).trim()}`);
  }
  throw err;
}
```

The existing `/Claude CLI failed.*overloaded/i` pattern in `isTransientLLMError` (line 232) stays as a safety net for any path that doesn't go through this catch — but in practice the new code intercepts before that test runs.

### `retryTransient` changes (`src/llm.js`, current line ~249)

Add two branches at the top of the `catch (err)` block, before the existing `isTransient` check:

```js
} catch (err) {
  lastErr = err;
  if (err instanceof RateLimitError) {
    const ms = err.retryAfterMs;
    log(`[llm] rate-limited (${err.message}); sleeping ${Math.round(ms / 1000)}s before retry`);
    await sleep(ms);
    log(`[llm] resuming after ${Math.round(ms / 1000)}s wait`);
    continue;  // do NOT increment attempt — retry budget unaffected
  }
  if (err instanceof ClaudeCliRateLimitError) {
    await waitForUserResume({ log });  // see below
    continue;  // do NOT increment attempt
  }
  if (attempt === maxRetries || !isTransient(err)) throw err;
  const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 1000);
  await sleep(delay);
}
```

Note: the existing loop uses `for (let attempt = 0; attempt <= maxRetries; attempt++)`. `continue` re-runs the loop without incrementing — but the for-loop's increment runs anyway on `continue`. **Correction:** the loop must be restructured slightly so rate-limit retries don't consume the budget. Concretely, replace the for-loop with a while-loop and increment `attempt` only on the bounded-transient branch:

```js
let attempt = 0;
while (true) {
  try {
    return await fn(attempt);
  } catch (err) {
    lastErr = err;
    if (err instanceof RateLimitError) {
      log(`[llm] rate-limited; sleeping ${Math.round(err.retryAfterMs / 1000)}s before retry`);
      await sleep(err.retryAfterMs);
      log(`[llm] resuming after ${Math.round(err.retryAfterMs / 1000)}s wait`);
      continue;  // attempt unchanged
    }
    if (err instanceof ClaudeCliRateLimitError) {
      await waitForUserResume({ log });
      log(`[llm] resuming after user signal`);
      continue;  // attempt unchanged
    }
    if (attempt >= maxRetries || !isTransient(err)) throw err;
    const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 1000);
    await sleep(delay);
    attempt += 1;
  }
}
```

### `waitForUserResume` (new helper in `src/llm.js`)

```js
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DATA_DIR } from './constants.js';

const RESUME_FLAG_PATH = join(DATA_DIR, 'resume.flag');
const RESUME_POLL_MS = 30_000;

async function waitForUserResume({ log = console.log, sleep = defaultSleep } = {}) {
  if (process.stdin.isTTY) {
    log('[claude-cli] rate limit reached. Press Enter to retry (Ctrl+C to abort).');
    await new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', () => { rl.close(); resolve(); });
    });
  } else {
    log(`[claude-cli] rate limit reached. Run 'duanju-writer resume' (or touch ${RESUME_FLAG_PATH}) to retry.`);
    mkdirSync(DATA_DIR, { recursive: true });
    while (!existsSync(RESUME_FLAG_PATH)) {
      await sleep(RESUME_POLL_MS);
    }
    try { unlinkSync(RESUME_FLAG_PATH); } catch {}  // single-use; tolerate races
  }
}
```

The function accepts injected `sleep` and `log` so tests can drive it deterministically without 30-second waits or stdout pollution.

### `bin/duanju-writer.js` changes

A `case 'resume':` block:

```js
case 'resume': {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const flag = join(DATA_DIR, 'resume.flag');
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(flag, new Date().toISOString());
  console.log(`Resume signal written to ${flag}`);
  break;
}
```

`DATA_DIR` is already imported from `../src/constants.js`.

The top-of-file usage list is updated:
```
duanju-writer [setup|start|scheduler|worker|run|jobs|styles|config|provider|role|knowledge|resume]
```

## Logging

| Event | Level | Message |
|---|---|---|
| HTTP 429 enter | info | `[llm] rate-limited; sleeping <N>s before retry` |
| HTTP 429 resume | info | `[llm] resuming after <N>s wait` |
| Claude CLI 429 enter (TTY) | info | `[claude-cli] rate limit reached. Press Enter to retry (Ctrl+C to abort).` |
| Claude CLI 429 enter (daemon) | info | `[claude-cli] rate limit reached. Run 'duanju-writer resume' (or touch <path>) to retry.` |
| Claude CLI 429 resume | info | `[llm] resuming after user signal` |

Daemon polling ticks (every 30s while waiting for sentinel) are silent.

No worklog (`wlog`) entries — rate-limit events live at the LLM layer; the worker doesn't need to know.

## Error handling

| Failure | Behavior |
|---|---|
| `Retry-After` header missing | fall back to 60_000 ms |
| `Retry-After` header malformed (negative seconds, garbage) | fall back to 60_000 ms |
| `Retry-After` header is HTTP-date in the past | fall back to 60_000 ms |
| `Retry-After-Ms` header non-numeric | ignored; consult `Retry-After`; final fallback 60_000 ms |
| Claude CLI rate-limit detected, but the next attempt errors with a non-rate-limit failure | propagate that error normally; bounded transient retry applies if it's transient |
| Sentinel file written but rate limit still in effect | next call throws `ClaudeCliRateLimitError` again, loop pauses again, user signals again |
| TTY check returns wrong answer (e.g. running under `script(1)` faking a TTY) | best-effort; user can Ctrl+C and re-run with output redirected to force daemon mode |

## Testing

| Test file | Coverage |
|---|---|
| `tests/llm-rate-limit.test.js` (new) | `parseRetryAfter` — seconds, HTTP date (future and past), missing both, malformed; `Retry-After-Ms` priority over `Retry-After`; default 60_000 fallback; |
| `tests/llm-rate-limit.test.js` | `retryTransient` honors `RateLimitError.retryAfterMs` via injected `sleep`; does NOT consume retry budget when only `RateLimitError`s thrown (loop runs e.g. 5 times, succeeds); propagates non-rate-limit non-transient error immediately; bounded-transient path still works for plain `Error` |
| `tests/llm-rate-limit.test.js` | `waitForUserResume` — TTY mode resolves on injected stdin newline (mock `readline.createInterface`); non-TTY mode resolves when sentinel file appears (use temp `DATA_DIR` via env var override or by injecting the path); cleans up the file after consume |
| `tests/cli-flags.test.js` (extend) | `duanju-writer resume` exits 0 and writes the sentinel; running it twice without intervening consume just rewrites the file (idempotent) |

LLM-layer tests use a stubbed `provider.call` that throws `RateLimitError(50)` (50 ms) once then returns "ok" — fast, deterministic. The `parseRetryAfter` helper is pure and tested in isolation.

## Future enhancements (out of scope for v1)

- Configurable fallback / polling intervals.
- Surface pause state in `duanju-writer jobs` output.
- Per-role rate-limit isolation (if a project ever fans out parallel role calls).
- Auto-detect "resume" by probing the API every N minutes instead of waiting for a sentinel — would let the daemon recover unattended.
- Pre-emptive token-budget tracking to avoid 429 in the first place.
