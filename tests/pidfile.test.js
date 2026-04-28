import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const TEST_DIR = join(import.meta.dirname, '.test_pidfile');

function freshPidfile() {
  return join(TEST_DIR, `daemon.${randomBytes(4).toString('hex')}.pids`);
}

describe('pidfile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('readPidfileFrom returns empty state when file missing', async () => {
    const { readPidfileFrom } = await import('../src/pidfile.js');
    const state = readPidfileFrom(freshPidfile());
    assert.deepEqual(state, { parent: null, children: [] });
  });

  test('readPidfileFrom returns empty state for invalid JSON', async () => {
    const { readPidfileFrom } = await import('../src/pidfile.js');
    const f = freshPidfile();
    writeFileSync(f, 'garbage', 'utf8');
    const state = readPidfileFrom(f);
    assert.deepEqual(state, { parent: null, children: [] });
  });

  test('registerParentIn writes parent PID', async () => {
    const { registerParentIn, readPidfileFrom } = await import('../src/pidfile.js');
    const f = freshPidfile();
    registerParentIn(f, 1234);
    const state = readPidfileFrom(f);
    assert.equal(state.parent, 1234);
    assert.deepEqual(state.children, []);
  });

  test('unregisterParentIn clears parent only when PID matches', async () => {
    const { registerParentIn, unregisterParentIn, readPidfileFrom } = await import('../src/pidfile.js');
    const f = freshPidfile();
    registerParentIn(f, 1234);
    unregisterParentIn(f, 9999); // non-matching
    assert.equal(readPidfileFrom(f).parent, 1234);
    unregisterParentIn(f, 1234);
    assert.equal(readPidfileFrom(f).parent, null);
  });

  test('registerChildIn appends unique child PIDs', async () => {
    const { registerChildIn, readPidfileFrom } = await import('../src/pidfile.js');
    const f = freshPidfile();
    registerChildIn(f, 100);
    registerChildIn(f, 200);
    registerChildIn(f, 100); // dup, should be ignored
    const state = readPidfileFrom(f);
    assert.deepEqual(state.children.sort(), [100, 200]);
  });

  test('unregisterChildIn removes the given PID', async () => {
    const { registerChildIn, unregisterChildIn, readPidfileFrom } = await import('../src/pidfile.js');
    const f = freshPidfile();
    registerChildIn(f, 100);
    registerChildIn(f, 200);
    unregisterChildIn(f, 100);
    const state = readPidfileFrom(f);
    assert.deepEqual(state.children, [200]);
  });

  test('cleanupStaleIn clears pidfile when nothing alive', async () => {
    const { registerParentIn, registerChildIn, cleanupStaleIn, readPidfileFrom } =
      await import('../src/pidfile.js');
    const f = freshPidfile();
    registerParentIn(f, 111);
    registerChildIn(f, 222);
    const result = cleanupStaleIn(f, {
      isAlive: () => false,
      commandFor: () => '',
      sendSignal: () => {},
      graceMs: 0,
    });
    assert.deepEqual(result.killed, []);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(readPidfileFrom(f), { parent: null, children: [] });
  });

  test('cleanupStaleIn kills alive PIDs whose command matches signature', async () => {
    const { registerParentIn, registerChildIn, cleanupStaleIn, readPidfileFrom } =
      await import('../src/pidfile.js');
    const f = freshPidfile();
    registerParentIn(f, 111);
    registerChildIn(f, 222);

    const signals = [];
    const result = cleanupStaleIn(f, {
      isAlive: () => true,
      commandFor: (pid) => (pid === 111 ? 'node /usr/local/bin/duanju-writer start' : 'claude -p'),
      sendSignal: (pid, sig) => { signals.push([pid, sig]); },
      graceMs: 0,
    });

    assert.ok(result.killed.includes(111));
    assert.ok(result.killed.includes(222));
    assert.deepEqual(result.skipped, []);
    const terms = signals.filter(([, s]) => s === 'SIGTERM').map(([p]) => p).sort();
    const kills = signals.filter(([, s]) => s === 'SIGKILL').map(([p]) => p).sort();
    assert.deepEqual(terms, [111, 222]);
    assert.deepEqual(kills, [111, 222]);
    assert.deepEqual(readPidfileFrom(f), { parent: null, children: [] });
  });

  test('cleanupStaleIn skips PIDs whose command does not match signature', async () => {
    const { registerChildIn, cleanupStaleIn } = await import('../src/pidfile.js');
    const f = freshPidfile();
    registerChildIn(f, 333);
    const signals = [];
    const result = cleanupStaleIn(f, {
      isAlive: () => true,
      commandFor: () => 'chrome --foo',
      sendSignal: (pid, sig) => { signals.push([pid, sig]); },
      graceMs: 0,
    });
    assert.deepEqual(result.killed, []);
    assert.deepEqual(result.skipped, [333]);
    assert.deepEqual(signals, []);
  });

  test('cleanupStaleIn skips SIGKILL if PID died after SIGTERM', async () => {
    const { registerChildIn, cleanupStaleIn } = await import('../src/pidfile.js');
    const f = freshPidfile();
    registerChildIn(f, 444);
    const signals = [];
    let aliveCalls = 0;
    const result = cleanupStaleIn(f, {
      isAlive: () => {
        aliveCalls++;
        return aliveCalls === 1;
      },
      commandFor: () => 'claude -p',
      sendSignal: (pid, sig) => { signals.push([pid, sig]); },
      graceMs: 0,
    });
    assert.deepEqual(result.killed, [444]);
    assert.deepEqual(signals, [[444, 'SIGTERM']]);
  });

  test('cleanupStaleIn actually terminates a real subprocess', async () => {
    const { registerChildIn, cleanupStaleIn } = await import('../src/pidfile.js');
    const f = freshPidfile();
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      await new Promise(r => setTimeout(r, 50));
      assert.ok(child.pid, 'spawned child should have a pid');
      registerChildIn(f, child.pid);

      const result = cleanupStaleIn(f, {
        matchesSignature: () => true,
        graceMs: 500,
      });

      assert.ok(result.killed.includes(child.pid), 'cleanup should kill spawned child');

      await new Promise(r => setTimeout(r, 100));
      assert.throws(() => process.kill(child.pid, 0), /ESRCH/);
    } finally {
      try { child.kill('SIGKILL'); } catch {}
    }
  });
});
