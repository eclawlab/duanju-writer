import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLock, sleepSync } from '../src/lock.js';

test('withLock runs fn and returns its value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-lock-'));
  const target = join(dir, 'data.json');
  try {
    const result = withLock(target, () => 42);
    assert.equal(result, 42);
    // Lock file is released after fn returns.
    assert.equal(existsSync(target + '.lock'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withLock releases the lock even when fn throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-lock-'));
  const target = join(dir, 'data.json');
  try {
    assert.throws(() => withLock(target, () => { throw new Error('boom'); }), /boom/);
    assert.equal(existsSync(target + '.lock'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withLock takes over a stale lock (older than 30s)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-lock-'));
  const target = join(dir, 'data.json');
  const lockPath = target + '.lock';
  try {
    // Simulate a lock left by a crashed process, aged well past the stale TTL.
    writeFileSync(lockPath, '');
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(lockPath, old, old);
    const result = withLock(target, () => 'recovered');
    assert.equal(result, 'recovered');
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sleepSync blocks roughly the requested duration', () => {
  const start = Date.now();
  sleepSync(30);
  assert.ok(Date.now() - start >= 25, 'should block at least ~30ms');
});
