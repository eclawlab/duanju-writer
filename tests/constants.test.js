import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { homedir } from 'node:os';

describe('constants', () => {
  test('exports VERSION', async () => {
    const { VERSION } = await import('../src/constants.js');
    assert.equal(VERSION, '0.1.9');
  });

  test('exports NAME', async () => {
    const { NAME } = await import('../src/constants.js');
    assert.equal(NAME, 'duanju-writer');
  });

  test('DATA_DIR is under home directory', async () => {
    const { DATA_DIR } = await import('../src/constants.js');
    const home = process.env.HOME || homedir();
    assert.equal(DATA_DIR, join(home, '.duanju-writer'));
  });

  test('CONFIG_FILE is inside DATA_DIR', async () => {
    const { CONFIG_FILE, DATA_DIR } = await import('../src/constants.js');
    assert.equal(CONFIG_FILE, join(DATA_DIR, 'config.json'));
  });

  test('JOBS_FILE is inside DATA_DIR', async () => {
    const { JOBS_FILE, DATA_DIR } = await import('../src/constants.js');
    assert.equal(JOBS_FILE, join(DATA_DIR, 'jobs.json'));
  });

  test('HISTORY_FILE is inside DATA_DIR', async () => {
    const { HISTORY_FILE, DATA_DIR } = await import('../src/constants.js');
    assert.equal(HISTORY_FILE, join(DATA_DIR, 'history.json'));
  });

  test('JOBS_DIR is inside DATA_DIR', async () => {
    const { JOBS_DIR, DATA_DIR } = await import('../src/constants.js');
    assert.equal(JOBS_DIR, join(DATA_DIR, 'jobs'));
  });

  test('PIDFILE is inside DATA_DIR', async () => {
    const { PIDFILE, DATA_DIR } = await import('../src/constants.js');
    assert.equal(PIDFILE, join(DATA_DIR, 'daemon.pids'));
  });

  test('DEFAULT_HEARTBEAT_INTERVAL is 30 minutes', async () => {
    const { DEFAULT_HEARTBEAT_INTERVAL } = await import('../src/constants.js');
    assert.equal(DEFAULT_HEARTBEAT_INTERVAL, 1800000);
  });

  test('CLAUDE_TIMEOUT is 5 minutes', async () => {
    const { CLAUDE_TIMEOUT } = await import('../src/constants.js');
    assert.equal(CLAUDE_TIMEOUT, 300000);
  });

  test('MAX_RETRIES is 3', async () => {
    const { MAX_RETRIES } = await import('../src/constants.js');
    assert.equal(MAX_RETRIES, 3);
  });

  test('WORKER_POLL_INTERVAL is 5 seconds', async () => {
    const { WORKER_POLL_INTERVAL } = await import('../src/constants.js');
    assert.equal(WORKER_POLL_INTERVAL, 5000);
  });
});
