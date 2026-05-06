# Rate-Limit Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an LLM call is rate-limited, pause inside `callLLM`/`retryTransient` rather than failing — HTTP providers auto-resume after `Retry-After`, Claude CLI pauses for user signal (Press Enter on TTY, `duanju-writer resume` or sentinel file in daemon mode).

**Architecture:** All work lives in `src/llm.js` plus a one-block addition to `bin/duanju-writer.js` for the new `resume` subcommand. Two new error classes (`RateLimitError`, `ClaudeCliRateLimitError`) carry the rate-limit signal from provider adapters into `retryTransient`. The retry loop is restructured from a `for` to a `while` so rate-limit waits don't consume the existing 3-attempt transient-retry budget.

**Tech Stack:** Node.js ≥ 20, ES modules, `node:test`, existing `node:fs` / `node:readline`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-05-rate-limit-pause-design.md`

---

## File map

**New files:**
- `tests/llm-rate-limit.test.js` — unit tests for `parseRetryAfter`, the two error classes, the OpenAI/Claude-CLI adapter rate-limit branches, `retryTransient` rate-limit handling, `waitForUserResume`.

**Modified files:**
- `src/llm.js`:
  - Add `parseRetryAfter` (exported pure helper).
  - Add `RateLimitError` and `ClaudeCliRateLimitError` exported classes.
  - Modify OpenAI adapter to throw `RateLimitError` on HTTP 429.
  - Modify Claude CLI adapter to throw `ClaudeCliRateLimitError` on usage-limit / overloaded / rate-limit stderr patterns.
  - Restructure `retryTransient` from `for` to `while`; add `RateLimitError` / `ClaudeCliRateLimitError` branches.
  - Add `waitForUserResume` (private, but reachable through dependency injection for tests).
- `bin/duanju-writer.js`:
  - Add `case 'resume':` block.
  - Update top-of-file usage list and help text.
- `tests/cli-flags.test.js` (extend) — `duanju-writer resume` writes sentinel file.

**No changes to:** `src/worker.js`, `src/queue.js`, `src/scheduler.js`, `src/config.js`, or any other file. The pause is invisible to the worker pipeline.

---

## Task 1: `parseRetryAfter` helper (pure)

**Files:**
- Modify: `src/llm.js`
- Test: `tests/llm-rate-limit.test.js`

Pure helper that extracts an ms wait time from `Retry-After-Ms` (Anthropic-style, takes priority) and `Retry-After` (RFC 7231 — seconds or HTTP date). Falls back to 60_000 ms.

- [ ] **Step 1: Create the test file with parseRetryAfter tests**

```javascript
// tests/llm-rate-limit.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('parseRetryAfter', () => {
  test('Retry-After-Ms (numeric) wins when present', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter('5000', '999'), 5000);
  });

  test('Retry-After-Ms is ignored when not a positive number', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter('-5', '7'), 7000);
    assert.equal(parseRetryAfter('garbage', '7'), 7000);
    assert.equal(parseRetryAfter('0', '7'), 7000);
  });

  test('Retry-After numeric seconds → ms', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter(null, '60'), 60_000);
    assert.equal(parseRetryAfter(undefined, '   30   '), 30_000);
  });

  test('Retry-After HTTP-date in the future → diff in ms', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    const future = new Date(Date.now() + 90_000).toUTCString();
    const ms = parseRetryAfter(null, future);
    assert.ok(ms >= 80_000 && ms <= 100_000, `expected ~90000, got ${ms}`);
  });

  test('Retry-After HTTP-date in the past → fallback', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    const past = new Date(Date.now() - 1000).toUTCString();
    assert.equal(parseRetryAfter(null, past), 60_000);
  });

  test('both headers missing → 60000 fallback', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter(null, null), 60_000);
    assert.equal(parseRetryAfter(undefined, undefined), 60_000);
  });

  test('garbage Retry-After → fallback', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter(null, 'not a date or number'), 60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 2 parseRetryAfter | head -20`
Expected: FAIL with `parseRetryAfter is not a function`.

- [ ] **Step 3: Implement `parseRetryAfter` in `src/llm.js`**

Add this function to `src/llm.js`. Best placed near the top of the file, right after the `defaultUnregisterChild` import block (around line 15) — or anywhere before `isTransientLLMError`.

```javascript
/**
 * Parse a Retry-After response header into milliseconds.
 * Honors `Retry-After-Ms` (Anthropic-style) over `Retry-After` (RFC 7231).
 * Falls back to 60_000 ms when both are missing/unparseable.
 * @param {string|null|undefined} msHeader - value of `Retry-After-Ms` header
 * @param {string|null|undefined} secondsHeader - value of `Retry-After` header
 * @returns {number} milliseconds to wait
 */
export function parseRetryAfter(msHeader, secondsHeader) {
  if (msHeader != null) {
    const ms = Number(msHeader);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (secondsHeader != null) {
    const trimmed = String(secondsHeader).trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed) * 1000;
    }
    const t = Date.parse(trimmed);
    if (Number.isFinite(t)) {
      const ms = t - Date.now();
      if (ms > 0) return ms;
    }
  }
  return 60_000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: all `parseRetryAfter` tests pass; total test count + 7 new, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: add parseRetryAfter helper for Retry-After header"
```

---

## Task 2: `RateLimitError` and `ClaudeCliRateLimitError` classes

**Files:**
- Modify: `src/llm.js`
- Test: `tests/llm-rate-limit.test.js`

Two exported error subclasses. `RateLimitError` carries `retryAfterMs` for HTTP providers; `ClaudeCliRateLimitError` is a pure marker for the CLI (no duration — wait is user-driven).

- [ ] **Step 1: Append failing tests**

Append to `tests/llm-rate-limit.test.js`:

```javascript
describe('RateLimitError', () => {
  test('extends Error and carries retryAfterMs', async () => {
    const { RateLimitError } = await import('../src/llm.js');
    const err = new RateLimitError(45_000);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.retryAfterMs, 45_000);
    assert.equal(err.name, 'RateLimitError');
    assert.match(err.message, /45000/);
  });

  test('appends provider info when given', async () => {
    const { RateLimitError } = await import('../src/llm.js');
    const err = new RateLimitError(1000, 'https://api.deepseek.com/v1');
    assert.match(err.message, /deepseek/);
  });
});

describe('ClaudeCliRateLimitError', () => {
  test('extends Error with default message', async () => {
    const { ClaudeCliRateLimitError } = await import('../src/llm.js');
    const err = new ClaudeCliRateLimitError();
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ClaudeCliRateLimitError);
    assert.equal(err.name, 'ClaudeCliRateLimitError');
    assert.match(err.message, /rate limit/i);
  });

  test('accepts a custom message', async () => {
    const { ClaudeCliRateLimitError } = await import('../src/llm.js');
    const err = new ClaudeCliRateLimitError('hit the wall');
    assert.equal(err.message, 'hit the wall');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "RateLimitError|ClaudeCliRateLimitError" | head`
Expected: FAIL with `RateLimitError is not a constructor` etc.

- [ ] **Step 3: Add the two classes to `src/llm.js`**

Append these classes near `parseRetryAfter` (still in the top of the file, near other exports):

```javascript
export class RateLimitError extends Error {
  constructor(retryAfterMs, providerInfo = '') {
    const suffix = providerInfo ? ` (${providerInfo})` : '';
    super(`LLM rate-limited; retry after ${retryAfterMs}ms${suffix}`);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: add RateLimitError and ClaudeCliRateLimitError classes"
```

---

## Task 3: OpenAI adapter throws `RateLimitError` on HTTP 429

**Files:**
- Modify: `src/llm.js` (OpenAI adapter, around line 38–95)
- Test: `tests/llm-rate-limit.test.js`

Currently the OpenAI adapter throws a generic Error on any non-OK response. Modify the 429 branch to throw `RateLimitError` with the parsed wait time.

- [ ] **Step 1: Append failing tests**

```javascript
describe('OpenAI adapter rate-limit handling', () => {
  test('throws RateLimitError on HTTP 429 with Retry-After-Ms', async () => {
    const { createOpenAIAdapter, RateLimitError } = await import('../src/llm.js');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => ({ 'retry-after-ms': '7500', 'retry-after': '999' })[name.toLowerCase()] || null },
      text: async () => '{"error":"too many requests"}',
    });
    try {
      const adapter = createOpenAIAdapter({ baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'k' });
      await assert.rejects(() => adapter.call('hi'), (err) => {
        assert.ok(err instanceof RateLimitError);
        assert.equal(err.retryAfterMs, 7500);
        return true;
      });
    } finally { global.fetch = originalFetch; }
  });

  test('throws RateLimitError on HTTP 429 with Retry-After (seconds)', async () => {
    const { createOpenAIAdapter, RateLimitError } = await import('../src/llm.js');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '45' : null },
      text: async () => '',
    });
    try {
      const adapter = createOpenAIAdapter({ baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'k' });
      await assert.rejects(() => adapter.call('hi'), (err) => {
        assert.ok(err instanceof RateLimitError);
        assert.equal(err.retryAfterMs, 45_000);
        return true;
      });
    } finally { global.fetch = originalFetch; }
  });

  test('throws RateLimitError on HTTP 429 with no headers (60s fallback)', async () => {
    const { createOpenAIAdapter, RateLimitError } = await import('../src/llm.js');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => '',
    });
    try {
      const adapter = createOpenAIAdapter({ baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'k' });
      await assert.rejects(() => adapter.call('hi'), (err) => {
        assert.ok(err instanceof RateLimitError);
        assert.equal(err.retryAfterMs, 60_000);
        return true;
      });
    } finally { global.fetch = originalFetch; }
  });

  test('still throws plain Error on non-429 (e.g. HTTP 500)', async () => {
    const { createOpenAIAdapter, RateLimitError } = await import('../src/llm.js');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => 'internal error',
    });
    try {
      const adapter = createOpenAIAdapter({ baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'k' });
      await assert.rejects(() => adapter.call('hi'), (err) => {
        assert.ok(!(err instanceof RateLimitError), 'must not be RateLimitError');
        assert.match(err.message, /HTTP 500/);
        return true;
      });
    } finally { global.fetch = originalFetch; }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A 2 "OpenAI adapter rate-limit"`
Expected: FAIL — current adapter throws plain Error on 429, not `RateLimitError`.

- [ ] **Step 3: Modify the OpenAI adapter in `src/llm.js`**

Locate the existing `if (!response.ok) { ... }` block (around line 69). Replace it with:

```javascript
      if (!response.ok) {
        // Drain the body so the underlying socket isn't held until GC
        const errBody = await response.text().catch(() => '');
        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(
            response.headers.get('retry-after-ms'),
            response.headers.get('retry-after')
          );
          throw new RateLimitError(retryAfterMs, baseUrl);
        }
        const snippet = errBody ? ` - ${errBody.slice(0, 200)}` : '';
        throw new Error(`LLM request failed: HTTP ${response.status}${snippet}`);
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: all 4 OpenAI-adapter tests pass; existing OpenAI adapter tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: OpenAI adapter throws RateLimitError on HTTP 429"
```

---

## Task 4: Claude CLI adapter throws `ClaudeCliRateLimitError` on usage-limit pattern

**Files:**
- Modify: `src/llm.js` (Claude CLI adapter, around line 105–188)
- Test: `tests/llm-rate-limit.test.js`

Claude CLI surfaces rate-limit hits via stderr (e.g. "Claude AI usage limit reached", "Anthropic API overloaded", or similar). Detect the pattern and throw `ClaudeCliRateLimitError`.

- [ ] **Step 1: Append failing tests**

```javascript
describe('Claude CLI adapter rate-limit handling', () => {
  test('throws ClaudeCliRateLimitError on stderr with "usage limit reached"', async () => {
    const { createClaudeCliAdapter, ClaudeCliRateLimitError } = await import('../src/llm.js');
    // Use a tiny shell stub that prints to stderr and exits 1
    const adapter = createClaudeCliAdapter({
      claudePath: '/bin/sh',
      timeout: 5000,
      registerChild: () => {},
      unregisterChild: () => {},
    });
    // Override the adapter's call by injecting a fake child via a different path
    // — instead let's stub execFile via a wrapper: simpler approach is to use
    // /bin/sh with `-c` baked into args, but the adapter calls execFile with
    // fixed args. So we use a real shell command through a tiny script file.
    // For test simplicity: a temp shell script that prints to stderr and exits 1.
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
    const stubPath = join(dir, 'fake-claude.sh');
    writeFileSync(stubPath, '#!/bin/sh\necho "Claude AI usage limit reached" 1>&2\nexit 1\n');
    chmodSync(stubPath, 0o755);
    try {
      const a = createClaudeCliAdapter({ claudePath: stubPath, timeout: 5000, registerChild: () => {}, unregisterChild: () => {} });
      await assert.rejects(() => a.call('hi'), (err) => {
        assert.ok(err instanceof ClaudeCliRateLimitError, `expected ClaudeCliRateLimitError, got ${err.constructor.name}: ${err.message}`);
        assert.match(err.message, /usage limit reached/i);
        return true;
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('throws ClaudeCliRateLimitError on stderr with "overloaded"', async () => {
    const { createClaudeCliAdapter, ClaudeCliRateLimitError } = await import('../src/llm.js');
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
    const stubPath = join(dir, 'fake-claude.sh');
    writeFileSync(stubPath, '#!/bin/sh\necho "API request overloaded; please retry later" 1>&2\nexit 1\n');
    chmodSync(stubPath, 0o755);
    try {
      const a = createClaudeCliAdapter({ claudePath: stubPath, timeout: 5000, registerChild: () => {}, unregisterChild: () => {} });
      await assert.rejects(() => a.call('hi'), (err) => {
        assert.ok(err instanceof ClaudeCliRateLimitError);
        return true;
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('throws plain Error (NOT ClaudeCliRateLimitError) on unrelated stderr', async () => {
    const { createClaudeCliAdapter, ClaudeCliRateLimitError } = await import('../src/llm.js');
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
    const stubPath = join(dir, 'fake-claude.sh');
    writeFileSync(stubPath, '#!/bin/sh\necho "some other error" 1>&2\nexit 1\n');
    chmodSync(stubPath, 0o755);
    try {
      const a = createClaudeCliAdapter({ claudePath: stubPath, timeout: 5000, registerChild: () => {}, unregisterChild: () => {} });
      await assert.rejects(() => a.call('hi'), (err) => {
        assert.ok(!(err instanceof ClaudeCliRateLimitError));
        assert.match(err.message, /Claude CLI failed/);
        return true;
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A 2 "Claude CLI adapter rate-limit"`
Expected: FAIL — currently the adapter throws a plain `Error` for both rate-limit and non-rate-limit stderr.

- [ ] **Step 3: Modify the Claude CLI adapter in `src/llm.js`**

Locate the `if (err) { ... }` block (around line 134–141). Replace it with:

```javascript
            if (err) {
              if (err.killed) {
                done(reject, new Error(`Claude CLI timed out after ${timeout}ms`));
              } else {
                const text = `${stderr || ''} ${err.message || ''}`;
                if (/usage limit reached|rate.?limit|overloaded/i.test(text)) {
                  done(reject, new ClaudeCliRateLimitError(`Claude CLI rate limit reached: ${text.slice(0, 200).trim()}`));
                } else {
                  done(reject, new Error(`Claude CLI failed: ${err.message}\n${stderr}`));
                }
              }
              return;
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: 3 new Claude CLI tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: Claude CLI adapter throws ClaudeCliRateLimitError on usage-limit"
```

---

## Task 5: Restructure `retryTransient` from `for` to `while`

**Files:**
- Modify: `src/llm.js` (around line 249–266)
- Tests: existing `tests/llm.test.js` retryTransient tests (no new tests; existing ones must still pass)

The current `for (let attempt = 0; attempt <= maxRetries; attempt++)` loop auto-increments on every iteration. To make rate-limit retries free (not consume the budget), we need explicit control over `attempt`. Rewrite as a `while (true)` with manual increment.

This is a semantic-preserving refactor for transient errors: the `attempt` counter still goes 0 → 1 → 2 → ... → maxRetries with the same exp-backoff. We're just making increment explicit so future tasks can skip it on rate-limit branches.

- [ ] **Step 1: Run existing retryTransient tests to confirm baseline**

Run: `npm test 2>&1 | grep -A 2 retryTransient | head -20`
Expected: existing retryTransient tests pass.

- [ ] **Step 2: Replace the for-loop body of `retryTransient`**

Locate the existing function body (around line 254–266). Replace from `let lastErr;` through the closing `throw lastErr;` with:

```javascript
  let lastErr;
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isTransient(err)) throw err;
      const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 1000);
      await sleep(delay);
      attempt += 1;
    }
  }
  // unreachable — every path above either returns or throws
  // eslint-disable-next-line no-unreachable
  throw lastErr;
}
```

(Keep the function signature, the trailing `throw lastErr;` remains for ESLint completeness but is unreachable.)

- [ ] **Step 3: Run existing tests to verify behavior unchanged**

Run: `npm test 2>&1 | tail -10`
Expected: all existing retryTransient tests still pass; total counts unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/llm.js
git commit -m "refactor: rewrite retryTransient as while loop with explicit attempt"
```

---

## Task 6: `retryTransient` handles `RateLimitError` (auto-resume)

**Files:**
- Modify: `src/llm.js`
- Test: `tests/llm-rate-limit.test.js`

Add a branch to the catch block: when `err instanceof RateLimitError`, sleep `err.retryAfterMs`, do NOT increment `attempt`, and `continue`. Other branches unchanged.

- [ ] **Step 1: Append failing tests**

```javascript
describe('retryTransient handles RateLimitError', () => {
  test('sleeps retryAfterMs and retries without consuming budget', async () => {
    const { retryTransient, RateLimitError } = await import('../src/llm.js');
    let calls = 0;
    let totalSlept = 0;
    const fakeSleep = async (ms) => { totalSlept += ms; };
    const fn = async () => {
      calls++;
      if (calls < 5) throw new RateLimitError(7000);
      return 'ok';
    };
    const result = await retryTransient(fn, { sleep: fakeSleep, maxRetries: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 5, 'must call fn 5 times despite maxRetries=1');
    assert.equal(totalSlept, 4 * 7000, 'must sleep retryAfterMs each rate-limit');
  });

  test('rate-limit waits do not exhaust the transient retry budget', async () => {
    const { retryTransient, RateLimitError } = await import('../src/llm.js');
    let calls = 0;
    const fakeSleep = async () => {};
    const fn = async () => {
      calls++;
      // Throw 3 rate-limits, then a transient 503, then succeed.
      if (calls <= 3) throw new RateLimitError(50);
      if (calls === 4) throw new Error('LLM request failed: HTTP 503');
      return 'ok';
    };
    const result = await retryTransient(fn, { sleep: fakeSleep, maxRetries: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 5, 'rate-limits free; one transient retry consumed; one final success');
  });

  test('non-RateLimitError still consumes retry budget', async () => {
    const { retryTransient } = await import('../src/llm.js');
    let calls = 0;
    const fakeSleep = async () => {};
    const fn = async () => {
      calls++;
      throw new Error('LLM request failed: HTTP 503');
    };
    await assert.rejects(() => retryTransient(fn, { sleep: fakeSleep, maxRetries: 2 }), /HTTP 503/);
    assert.equal(calls, 3, 'one initial + two retries = 3 calls');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A 2 "retryTransient handles RateLimitError"`
Expected: FAIL — `retryTransient` currently treats `RateLimitError` like any other error and tries `isTransient(err)` which returns false (no string match), so it throws.

- [ ] **Step 3: Add the rate-limit branch to `retryTransient`**

Locate the catch block from Task 5. Insert the rate-limit branch before the existing `if (attempt >= maxRetries...)` line:

```javascript
    } catch (err) {
      lastErr = err;
      if (err instanceof RateLimitError) {
        const ms = err.retryAfterMs;
        // Use console.log so the message surfaces regardless of the worker's
        // log() context. Prepended with [llm] to match other LLM-layer prints.
        console.log(`[llm] rate-limited; sleeping ${Math.round(ms / 1000)}s before retry`);
        await sleep(ms);
        console.log(`[llm] resuming after ${Math.round(ms / 1000)}s wait`);
        continue;  // attempt unchanged
      }
      if (attempt >= maxRetries || !isTransient(err)) throw err;
      const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 1000);
      await sleep(delay);
      attempt += 1;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: all 3 new tests pass; existing retryTransient tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: retryTransient auto-pauses on RateLimitError"
```

---

## Task 7: `waitForUserResume` — TTY mode

**Files:**
- Modify: `src/llm.js`
- Test: `tests/llm-rate-limit.test.js`

A helper that awaits user signal: TTY → readline question (Enter); non-TTY → sentinel-file polling. This task implements only the TTY branch; Task 8 adds the non-TTY branch.

The helper accepts injectable `isTTY`, `createInterfaceFn`, `sleep`, `existsSyncFn`, and `flagPath` so tests can drive it deterministically.

- [ ] **Step 1: Append failing tests**

```javascript
describe('waitForUserResume — TTY mode', () => {
  test('resolves when readline question completes', async () => {
    const { waitForUserResume } = await import('../src/llm.js');
    let questioned = false;
    const fakeReadlineFactory = () => ({
      question: (prompt, cb) => { questioned = true; setImmediate(() => cb('')); },
      close: () => {},
    });
    const messages = [];
    const log = (m) => messages.push(m);
    await waitForUserResume({
      isTTY: true,
      createInterfaceFn: fakeReadlineFactory,
      log,
    });
    assert.ok(questioned, 'readline.question must have been called');
    assert.ok(messages.some(m => /Press Enter to retry/i.test(m)), 'TTY prompt must be logged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 2 "waitForUserResume"`
Expected: FAIL — `waitForUserResume` not yet exported.

- [ ] **Step 3: Add `waitForUserResume` to `src/llm.js`**

Append to the bottom of the file (near other private helpers, but above the closing — make it exported so tests can import it):

```javascript
import { existsSync as _defaultExistsSync, mkdirSync as _defaultMkdirSync, unlinkSync as _defaultUnlinkSync } from 'node:fs';
import { createInterface as _defaultCreateInterface } from 'node:readline';
import { join as _joinPath } from 'node:path';
import { DATA_DIR } from './constants.js';

const RESUME_FLAG_PATH = _joinPath(DATA_DIR, 'resume.flag');
const RESUME_POLL_MS = 30_000;

/**
 * Block until the user signals to resume.
 * - TTY: prompt and await Enter on stdin.
 * - Non-TTY: poll a sentinel file at <DATA_DIR>/resume.flag every 30s; consume
 *   (delete) the file when found.
 *
 * Accepts injection points for tests:
 *   isTTY (boolean), createInterfaceFn, sleep, existsSyncFn, mkdirSyncFn,
 *   unlinkSyncFn, flagPath, pollMs, log.
 */
export async function waitForUserResume(opts = {}) {
  const isTTY = opts.isTTY ?? !!process.stdin.isTTY;
  const log = opts.log || console.log;
  if (isTTY) {
    log('[claude-cli] rate limit reached. Press Enter to retry (Ctrl+C to abort).');
    const createInterfaceFn = opts.createInterfaceFn || _defaultCreateInterface;
    await new Promise((resolve) => {
      const rl = createInterfaceFn({ input: process.stdin, output: process.stdout });
      rl.question('', () => { rl.close(); resolve(); });
    });
    return;
  }
  // non-TTY branch added in Task 8
  throw new Error('waitForUserResume: non-TTY mode not yet implemented');
}
```

(Place these imports at the top of `src/llm.js` next to the other imports — not inline. The illustrative block above shows them grouped for readability; in practice consolidate them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -10`
Expected: TTY test passes.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: waitForUserResume TTY mode (readline)"
```

---

## Task 8: `waitForUserResume` — non-TTY mode (sentinel file)

**Files:**
- Modify: `src/llm.js`
- Test: `tests/llm-rate-limit.test.js`

Add the non-TTY branch: poll for the sentinel file every 30s, consume it when found.

- [ ] **Step 1: Append failing tests**

```javascript
describe('waitForUserResume — non-TTY mode', () => {
  test('resolves when sentinel file appears, then removes it', async () => {
    const { waitForUserResume } = await import('../src/llm.js');
    const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'resume-'));
    const flagPath = join(dir, 'resume.flag');
    let pollCount = 0;
    let createdAt = 0;
    const fakeSleep = async () => {
      pollCount++;
      // Create the flag file on the second poll
      if (pollCount === 2) writeFileSync(flagPath, 'go');
    };
    const messages = [];
    try {
      await waitForUserResume({
        isTTY: false,
        flagPath,
        pollMs: 1,
        sleep: fakeSleep,
        log: (m) => messages.push(m),
      });
      assert.ok(!existsSync(flagPath), 'flag must be consumed (deleted)');
      assert.ok(messages.some(m => /Run 'duanju-writer resume'/i.test(m)), 'must log resume instructions');
      assert.ok(pollCount >= 2, `expected at least 2 polls, got ${pollCount}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('returns immediately if flag already exists', async () => {
    const { waitForUserResume } = await import('../src/llm.js');
    const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'resume-'));
    const flagPath = join(dir, 'resume.flag');
    writeFileSync(flagPath, 'already');
    let pollCount = 0;
    const fakeSleep = async () => { pollCount++; };
    try {
      await waitForUserResume({ isTTY: false, flagPath, pollMs: 1, sleep: fakeSleep, log: () => {} });
      assert.equal(pollCount, 0, 'must not sleep when flag already present');
      assert.ok(!existsSync(flagPath));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A 2 "non-TTY mode"`
Expected: FAIL with "non-TTY mode not yet implemented".

- [ ] **Step 3: Replace the throw with the non-TTY branch**

In `waitForUserResume`, replace the `throw new Error(...)` with:

```javascript
  // Non-TTY: poll for sentinel file
  const flagPath = opts.flagPath || RESUME_FLAG_PATH;
  const pollMs = opts.pollMs ?? RESUME_POLL_MS;
  const sleepFn = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const existsSyncFn = opts.existsSyncFn || _defaultExistsSync;
  const mkdirSyncFn = opts.mkdirSyncFn || _defaultMkdirSync;
  const unlinkSyncFn = opts.unlinkSyncFn || _defaultUnlinkSync;
  log(`[claude-cli] rate limit reached. Run 'duanju-writer resume' (or touch ${flagPath}) to retry.`);
  try { mkdirSyncFn(_joinPath(flagPath, '..'), { recursive: true }); } catch {}
  while (!existsSyncFn(flagPath)) {
    await sleepFn(pollMs);
  }
  try { unlinkSyncFn(flagPath); } catch {}  // single-use; tolerate races
}
```

(The trailing `}` closes the `waitForUserResume` function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: both new non-TTY tests pass; TTY test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: waitForUserResume non-TTY mode (sentinel file)"
```

---

## Task 9: `retryTransient` handles `ClaudeCliRateLimitError`

**Files:**
- Modify: `src/llm.js`
- Test: `tests/llm-rate-limit.test.js`

Wire `waitForUserResume` into `retryTransient`. Like `RateLimitError`, this branch does NOT consume the retry budget.

- [ ] **Step 1: Append failing test**

```javascript
describe('retryTransient handles ClaudeCliRateLimitError', () => {
  test('calls waitForUserResume then retries', async () => {
    const { retryTransient, ClaudeCliRateLimitError } = await import('../src/llm.js');
    let waitedTimes = 0;
    let calls = 0;
    const fakeWait = async () => { waitedTimes++; };
    const fn = async () => {
      calls++;
      if (calls === 1) throw new ClaudeCliRateLimitError();
      return 'ok';
    };
    const result = await retryTransient(fn, {
      sleep: async () => {},
      maxRetries: 0,
      waitForUserResume: fakeWait,
    });
    assert.equal(result, 'ok');
    assert.equal(waitedTimes, 1);
    assert.equal(calls, 2);
  });

  test('multiple ClaudeCliRateLimitErrors do not consume retry budget', async () => {
    const { retryTransient, ClaudeCliRateLimitError } = await import('../src/llm.js');
    let calls = 0;
    const fakeWait = async () => {};
    const fn = async () => {
      calls++;
      if (calls < 4) throw new ClaudeCliRateLimitError();
      return 'ok';
    };
    const result = await retryTransient(fn, { sleep: async () => {}, maxRetries: 0, waitForUserResume: fakeWait });
    assert.equal(result, 'ok');
    assert.equal(calls, 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -A 2 "ClaudeCliRateLimitError"`
Expected: FAIL — `retryTransient` doesn't yet handle this error type or accept a `waitForUserResume` option.

- [ ] **Step 3: Add the Claude CLI branch to `retryTransient`**

Modify `retryTransient` to accept a `waitForUserResume` injection point:

```javascript
export async function retryTransient(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? LLM_MAX_RETRIES;
  const baseMs = opts.baseMs ?? LLM_RETRY_BASE_MS;
  const sleep = opts.sleep || defaultSleep;
  const isTransient = opts.isTransient || isTransientLLMError;
  const waitFn = opts.waitForUserResume || waitForUserResume;

  let lastErr;
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err instanceof RateLimitError) {
        const ms = err.retryAfterMs;
        console.log(`[llm] rate-limited; sleeping ${Math.round(ms / 1000)}s before retry`);
        await sleep(ms);
        console.log(`[llm] resuming after ${Math.round(ms / 1000)}s wait`);
        continue;
      }
      if (err instanceof ClaudeCliRateLimitError) {
        await waitFn();
        console.log('[llm] resuming after user signal');
        continue;
      }
      if (attempt >= maxRetries || !isTransient(err)) throw err;
      const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 1000);
      await sleep(delay);
      attempt += 1;
    }
  }
  // unreachable
  // eslint-disable-next-line no-unreachable
  throw lastErr;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -10`
Expected: 2 new ClaudeCliRateLimitError tests pass; all earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm.js tests/llm-rate-limit.test.js
git commit -m "feat: retryTransient pauses on ClaudeCliRateLimitError"
```

---

## Task 10: `duanju-writer resume` subcommand

**Files:**
- Modify: `bin/duanju-writer.js`
- Test: `tests/cli-flags.test.js`

A new CLI subcommand that writes the sentinel file to wake a waiting daemon.

- [ ] **Step 1: Append failing test**

Add to `tests/cli-flags.test.js`, in the existing `describe('cli flag validation', ...)` block (near the bottom):

```javascript
  test('resume subcommand writes the sentinel flag and exits 0', async () => {
    const { mkdtempSync, existsSync, rmSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');

    const dir = mkdtempSync(join(tmpdir(), 'dj-resume-'));
    try {
      // Override DATA_DIR via HOME so the resume.flag lands in our temp dir
      const env = { ...process.env, HOME: dir };
      const r = spawnSync('node', [BIN, 'resume'], { encoding: 'utf8', env });
      assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr: ${r.stderr}`);
      const flagPath = join(dir, '.duanju-writer', 'resume.flag');
      assert.ok(existsSync(flagPath), `expected ${flagPath} to exist`);
      // contents should be a recognizable ISO timestamp
      assert.match(readFileSync(flagPath, 'utf8'), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      assert.match(r.stdout, /Resume signal written/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 2 "resume subcommand"`
Expected: FAIL — `Unknown command: resume`.

- [ ] **Step 3: Add the resume case to `bin/duanju-writer.js`**

Locate the switch statement (look for `case 'jobs':` or `case 'config':` to find the spot). Add a new case:

```javascript
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | tail -10`
Expected: resume subcommand test passes.

- [ ] **Step 5: Commit**

```bash
git add bin/duanju-writer.js tests/cli-flags.test.js
git commit -m "feat: add 'duanju-writer resume' subcommand"
```

---

## Task 11: Update help text and command list

**Files:**
- Modify: `bin/duanju-writer.js`

Reflect the new `resume` subcommand in user-facing strings.

- [ ] **Step 1: Locate the usage string**

Run: `grep -n "Usage: duanju-writer" bin/duanju-writer.js`
Expected output: a single match showing the usage line in the default `case` of the command switch.

- [ ] **Step 2: Update the usage string**

The current line reads:

```javascript
console.log('Usage: duanju-writer [setup|start|scheduler|worker|run|jobs|styles|config|provider|role|knowledge]');
```

Replace it with:

```javascript
console.log('Usage: duanju-writer [setup|start|scheduler|worker|run|jobs|styles|config|provider|role|knowledge|resume]');
```

- [ ] **Step 3: Run test suite to confirm no regressions**

Run: `npm test 2>&1 | tail -10`
Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add bin/duanju-writer.js
git commit -m "docs: list 'resume' in CLI usage string"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: 0 failures, 0 cancelled. Test count = baseline + ~20 new tests.

- [ ] **Step 2: Manual smoke — `resume` subcommand**

```bash
node bin/duanju-writer.js resume
```

Expected: prints `Resume signal written to /Users/<you>/.duanju-writer/resume.flag` and exits 0; the flag file exists.

```bash
ls -l ~/.duanju-writer/resume.flag && cat ~/.duanju-writer/resume.flag
```

Expected: ISO timestamp.

- [ ] **Step 3: Manual smoke — usage string**

```bash
node bin/duanju-writer.js xxxunknown
```

Expected: prints `Unknown command: xxxunknown` followed by `Usage: ... resume]`.

- [ ] **Step 4: Clean up the smoke-test sentinel file**

```bash
rm -f ~/.duanju-writer/resume.flag
```

- [ ] **Step 5: No commit if no changes**

If the smoke tests revealed issues, fix and commit. Otherwise, no commit needed.

---

## Self-review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| `parseRetryAfter` helper (seconds, HTTP date, ms-precision, fallback) | Task 1 |
| `RateLimitError` exported class | Task 2 |
| `ClaudeCliRateLimitError` exported class | Task 2 |
| OpenAI adapter throws `RateLimitError` on 429 | Task 3 |
| Claude CLI adapter throws `ClaudeCliRateLimitError` on usage-limit pattern | Task 4 |
| `retryTransient` restructure (for → while) | Task 5 |
| `retryTransient` rate-limit branch (auto-resume) | Task 6 |
| `waitForUserResume` TTY mode (readline) | Task 7 |
| `waitForUserResume` non-TTY mode (sentinel file polling) | Task 8 |
| `retryTransient` Claude CLI branch | Task 9 |
| `duanju-writer resume` subcommand | Task 10 |
| Usage / help text update | Task 11 |
| Logging messages (entry, resume, sleep duration) | Tasks 6 & 9 |
| Final verification | Task 12 |

**Placeholder scan:** no TBDs, every step has concrete code or commands. The task 5 "unreachable throw lastErr" is documented intentionally for ESLint completeness, not a placeholder.

**Type consistency:** `parseRetryAfter`, `RateLimitError`, `ClaudeCliRateLimitError`, `waitForUserResume`, and `retryTransient` are referred to by the same names throughout. The `RESUME_FLAG_PATH` / `RESUME_POLL_MS` constants are defined once in Task 7. The `waitForUserResume` injection-point names (`isTTY`, `createInterfaceFn`, `flagPath`, `pollMs`, `sleep`, `existsSyncFn`, `mkdirSyncFn`, `unlinkSyncFn`, `log`) are consistent across Tasks 7, 8, and the test code.
