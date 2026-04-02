import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '.test_config');

describe('config', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('loadConfigFrom returns defaults when no file exists', async () => {
    const { loadConfigFrom } = await import('../src/config.js');
    const config = loadConfigFrom(join(TEST_DIR, 'config.json'));
    assert.equal(config.autostoryUrl, 'https://autostory-web.fly.dev');
    assert.equal(config.heartbeatInterval, 1800000);
    assert.equal(config.claudePath, 'claude');
    assert.equal(config.maxRetries, 3);
    assert.equal(config.maxConcurrentJobs, 1);
    assert.equal(config.publishOnUpload, true);
    assert.equal(config.aiApiKey, '');
  });

  test('saveConfigTo and loadConfigFrom round-trip', async () => {
    const { loadConfigFrom, saveConfigTo } = await import('../src/config.js');
    const file = join(TEST_DIR, 'config.json');
    saveConfigTo(file, { autostoryUrl: 'http://example.com', aiApiKey: 'test-key' });
    const config = loadConfigFrom(file);
    assert.equal(config.autostoryUrl, 'http://example.com');
    assert.equal(config.aiApiKey, 'test-key');
    // Defaults should still be present
    assert.equal(config.claudePath, 'claude');
    assert.equal(config.maxRetries, 3);
  });

  test('loadConfigFrom returns defaults for invalid JSON', async () => {
    const { loadConfigFrom } = await import('../src/config.js');
    const file = join(TEST_DIR, 'bad.json');
    writeFileSync(file, 'not valid json!!!', 'utf8');
    const config = loadConfigFrom(file);
    assert.equal(config.autostoryUrl, 'https://autostory-web.fly.dev');
    assert.equal(config.claudePath, 'claude');
  });

  test('saveConfigTo creates parent directories', async () => {
    const { saveConfigTo } = await import('../src/config.js');
    const file = join(TEST_DIR, 'nested', 'deep', 'config.json');
    saveConfigTo(file, { autostoryUrl: 'http://test.com' });
    assert.ok(existsSync(file));
    const content = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(content.autostoryUrl, 'http://test.com');
  });

  test('saveConfigTo writes formatted JSON with trailing newline', async () => {
    const { saveConfigTo } = await import('../src/config.js');
    const file = join(TEST_DIR, 'config.json');
    saveConfigTo(file, { key: 'value' });
    const raw = readFileSync(file, 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('  ')); // indented
  });

  test('user config overrides specific defaults', async () => {
    const { loadConfigFrom, saveConfigTo } = await import('../src/config.js');
    const file = join(TEST_DIR, 'config.json');
    saveConfigTo(file, { maxRetries: 10, heartbeatInterval: 60000 });
    const config = loadConfigFrom(file);
    assert.equal(config.maxRetries, 10);
    assert.equal(config.heartbeatInterval, 60000);
    // Untouched defaults remain
    assert.equal(config.autostoryUrl, 'https://autostory-web.fly.dev');
    assert.equal(config.claudePath, 'claude');
  });

  test('saveConfigTo overwrites existing file', async () => {
    const { loadConfigFrom, saveConfigTo } = await import('../src/config.js');
    const file = join(TEST_DIR, 'config.json');
    saveConfigTo(file, { aiApiKey: 'first' });
    saveConfigTo(file, { aiApiKey: 'second' });
    const config = loadConfigFrom(file);
    assert.equal(config.aiApiKey, 'second');
  });
});
