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

describe('Claude CLI adapter rate-limit handling', () => {
  test('throws ClaudeCliRateLimitError on stderr with "usage limit reached"', async () => {
    const { createClaudeCliAdapter, ClaudeCliRateLimitError } = await import('../src/llm.js');
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

describe('waitForUserResume — non-TTY mode', () => {
  test('resolves when sentinel file appears, then removes it', async () => {
    const { waitForUserResume } = await import('../src/llm.js');
    const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'resume-'));
    const flagPath = join(dir, 'resume.flag');
    let pollCount = 0;
    const fakeSleep = async () => {
      pollCount++;
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
