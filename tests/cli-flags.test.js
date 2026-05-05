import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BIN = new URL('../bin/duanju-copier.js', import.meta.url).pathname;

function runCli(args) {
  try {
    const out = execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
}

describe('cli flag validation', () => {
  test('--episodes 5 is rejected (below range)', () => {
    const r = runCli(['run', '--episodes', '5']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--episodes must be an integer in \[10, 40\]/);
  });

  test('--episodes 50 is rejected (above range)', () => {
    const r = runCli(['run', '--episodes', '50']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--episodes must be an integer in \[10, 40\]/);
  });

  test('--clips-per-episode 3 is rejected', () => {
    const r = runCli(['run', '--clips-per-episode', '3']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--clips-per-episode must be an integer in \[4, 10\]/);
  });

  test('--clips-per-episode 12 is rejected', () => {
    const r = runCli(['run', '--clips-per-episode', '12']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--clips-per-episode must be an integer in \[4, 10\]/);
  });

  test('--lang en is rejected', () => {
    const r = runCli(['run', '--lang', 'en']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--lang en is not supported \(CN only\)/);
  });

  test('config set novelType errors with rename hint', () => {
    const r = runCli(['config', 'set', 'novelType', '都市']);
    assert.equal(r.code, 1);
    assert.match(r.out, /'novelType' has been renamed to 'genre'/);
  });

  test('config set targetWordsPerScene errors with rename hint', () => {
    const r = runCli(['config', 'set', 'targetWordsPerScene', '50']);
    assert.equal(r.code, 1);
    assert.match(r.out, /'targetWordsPerScene' has been renamed to 'targetCharsPerClip'/);
  });

  test('config set lang en is rejected', () => {
    const r = runCli(['config', 'set', 'lang', 'en']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Only 'cn' is supported/);
  });
});
