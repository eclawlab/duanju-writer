import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('llm', () => {
  test('createProvider with openai type returns adapter', async () => {
    const { createProvider } = await import('../src/llm.js');
    const adapter = createProvider({
      type: 'openai',
      apiKey: 'test-key',
      baseUrl: 'http://localhost',
      model: 'gpt-4',
    });
    assert.ok(adapter, 'adapter should be truthy');
    assert.equal(typeof adapter.call, 'function', 'adapter.call should be a function');
  });

  test('createProvider with claude-cli type returns adapter', async () => {
    const { createProvider } = await import('../src/llm.js');
    const adapter = createProvider({ type: 'claude-cli' });
    assert.ok(adapter, 'adapter should be truthy');
    assert.equal(typeof adapter.call, 'function', 'adapter.call should be a function');
  });

  test('createProvider throws on unknown type', async () => {
    const { createProvider } = await import('../src/llm.js');
    assert.throws(
      () => createProvider({ type: 'badtype' }),
      /Unknown provider type: badtype/
    );
  });

  test('createProvider applies openai defaults', async () => {
    const { createProvider } = await import('../src/llm.js');
    // Should not throw even without temperature/maxTokens/timeout
    const adapter = createProvider({
      type: 'openai',
      apiKey: 'k',
      baseUrl: 'http://x',
      model: 'm',
    });
    assert.ok(adapter, 'adapter should exist');
    assert.equal(typeof adapter.call, 'function');
  });

  test('createProvider applies claude-cli defaults', async () => {
    const { createProvider } = await import('../src/llm.js');
    // Should not throw even without claudePath/timeout
    const adapter = createProvider({ type: 'claude-cli' });
    assert.ok(adapter, 'adapter should exist');
    assert.equal(typeof adapter.call, 'function');
  });

  test('clearProviderCache clears cached providers', async () => {
    const { clearProviderCache } = await import('../src/llm.js');
    // Should not throw
    assert.doesNotThrow(() => clearProviderCache());
  });

  test('createClaudeCliAdapter registers then unregisters child PID around the call', async () => {
    const { createClaudeCliAdapter } = await import('../src/llm.js');
    const events = [];
    const adapter = createClaudeCliAdapter({
      // sleep rejects the claude-style args and exits with error, but that's
      // fine — we only care that the adapter registered the child PID before
      // and unregistered it after, regardless of success/failure.
      claudePath: '/bin/sleep',
      timeout: 5000,
      registerChild: (pid) => events.push(['register', pid]),
      unregisterChild: (pid) => events.push(['unregister', pid]),
    });
    try { await adapter.call('test'); } catch {}
    assert.equal(events.length, 2, `expected one register + one unregister, got ${JSON.stringify(events)}`);
    assert.equal(events[0][0], 'register');
    assert.equal(events[1][0], 'unregister');
    assert.ok(Number.isInteger(events[0][1]) && events[0][1] > 0, 'registered pid should be a positive integer');
    assert.equal(events[0][1], events[1][1], 'registered and unregistered pids must match');
  });

  describe('isTransientLLMError', () => {
    test('classifies 5xx, 429, timeouts, and network errors as transient', async () => {
      const { isTransientLLMError } = await import('../src/llm.js');
      assert.equal(isTransientLLMError(new Error('LLM request failed: HTTP 503 - upstream busy')), true);
      assert.equal(isTransientLLMError(new Error('LLM request failed: HTTP 502')), true);
      assert.equal(isTransientLLMError(new Error('LLM request failed: HTTP 429')), true);
      assert.equal(isTransientLLMError(new Error('LLM request timed out after 60000ms')), true);
      assert.equal(isTransientLLMError(new Error('fetch failed: ECONNRESET')), true);
      assert.equal(isTransientLLMError(Object.assign(new Error('boom'), { code: 'ECONNRESET' })), true);
      assert.equal(isTransientLLMError(new Error('Claude CLI failed: api overloaded')), true);
    });

    test('treats 4xx, parse errors, and config errors as non-retryable', async () => {
      const { isTransientLLMError } = await import('../src/llm.js');
      assert.equal(isTransientLLMError(new Error('LLM request failed: HTTP 400 - bad request')), false);
      assert.equal(isTransientLLMError(new Error('LLM request failed: HTTP 401')), false);
      assert.equal(isTransientLLMError(new Error('LLM request failed: HTTP 404')), false);
      assert.equal(isTransientLLMError(new Error('Provider not found: nonsense')), false);
      assert.equal(isTransientLLMError(new Error('Unexpected token in JSON')), false);
      assert.equal(isTransientLLMError(null), false);
      assert.equal(isTransientLLMError(undefined), false);
    });
  });

  describe('retryTransient', () => {
    test('returns the value on first success without sleeping', async () => {
      const { retryTransient } = await import('../src/llm.js');
      const sleeps = [];
      const result = await retryTransient(() => Promise.resolve('ok'), {
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      });
      assert.equal(result, 'ok');
      assert.equal(sleeps.length, 0);
    });

    test('retries transient errors up to the bound, then resolves on success', async () => {
      const { retryTransient } = await import('../src/llm.js');
      let attempts = 0;
      const sleeps = [];
      const result = await retryTransient(() => {
        attempts++;
        if (attempts < 3) throw new Error('LLM request failed: HTTP 503');
        return 'recovered';
      }, {
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
        baseMs: 10,
      });
      assert.equal(result, 'recovered');
      assert.equal(attempts, 3);
      assert.equal(sleeps.length, 2);
    });

    test('does NOT retry non-transient errors (fails fast)', async () => {
      const { retryTransient } = await import('../src/llm.js');
      let attempts = 0;
      const sleeps = [];
      await assert.rejects(
        retryTransient(() => { attempts++; throw new Error('LLM request failed: HTTP 400'); }, {
          sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
          baseMs: 10,
        }),
        /HTTP 400/
      );
      assert.equal(attempts, 1, 'should not have retried a 4xx');
      assert.equal(sleeps.length, 0);
    });

    test('throws the last error after maxRetries+1 failed attempts', async () => {
      const { retryTransient } = await import('../src/llm.js');
      let attempts = 0;
      await assert.rejects(
        retryTransient(() => { attempts++; throw new Error('timed out'); }, {
          sleep: () => Promise.resolve(),
          baseMs: 1,
          maxRetries: 2,
        }),
        /timed out/
      );
      assert.equal(attempts, 3, 'should have tried initial + 2 retries');
    });
  });
});
