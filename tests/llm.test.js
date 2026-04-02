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
});
