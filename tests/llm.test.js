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
});
