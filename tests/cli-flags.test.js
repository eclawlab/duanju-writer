import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BIN = new URL('../bin/duanju-writer.js', import.meta.url).pathname;

function runCli(args) {
  try {
    const out = execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
}

describe('cli flag validation', () => {
  test('bare invocation prints usage and exits 0 (does not start the daemon)', () => {
    let out = '';
    let code;
    try {
      out = execFileSync('node', [BIN], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8000,
      });
      code = 0;
    } catch (err) {
      out = (err.stdout || '') + (err.stderr || '');
      code = err.status;
      if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        assert.fail('bare `duanju-writer` hung (started the daemon) instead of printing usage');
      }
    }
    assert.equal(code, 0);
    assert.match(out, /Usage: duanju-writer/);
  });

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

  test('run with a non-finite count (Infinity) is rejected, not a silent no-op', () => {
    const r = runCli(['run', 'Infinity']);
    assert.equal(r.code, 1);
    assert.match(r.out, /count/i);
  });

  test('run with scientific-notation count (1e3) is rejected before any job', () => {
    const r = runCli(['run', '1e3']);
    assert.equal(r.code, 1);
    assert.match(r.out, /count must be a non-negative integer/);
  });

  test('run with two positional counts is rejected', () => {
    const r = runCli(['run', '2', '3']);
    assert.equal(r.code, 1);
    assert.match(r.out, /single count/);
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

  test('--author-style with unknown name is rejected; list shows author names', () => {
    const r = runCli(['run', '--author-style', 'J.K. Rowling']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Unknown author style: "J\.K\. Rowling"/);
    assert.match(r.out, /Available author styles:/);
    // The list must surface author names (not just opaque keys) so users
    // know what to type for --author-style.
    assert.match(r.out, /Mo Yan \(莫言\)/);
  });

  test('author-styles subcommand lists the 15 authors', () => {
    const r = runCli(['author-styles']);
    assert.equal(r.code, 0);
    assert.match(r.out, /moyan/);
    assert.match(r.out, /chinese-literary/);
  });

  test('config set accepts authorStyle key', () => {
    const r = runCli(['config', 'set', 'authorStyle', 'moyan']);
    assert.equal(r.code, 0);
    assert.match(r.out, /authorStyle/);
    // reset so the test is idempotent and does not leak into other runs
    runCli(['config', 'set', 'authorStyle', '']);
  });

  test('--author-style does not conflict with --story (orthogonal)', () => {
    const r = runCli(['run', '--story', 'tests/fixtures/__nope__.txt', '--author-style', 'moyan']);
    assert.equal(r.code, 1);
    assert.ok(!/mutually exclusive/i.test(r.out), `unexpected mutual-exclusion error: ${r.out}`);
    assert.ok(!/Unknown author style/.test(r.out), `unexpected unknown-author error: ${r.out}`);
    assert.match(r.out, /--story/);
  });

  test('resume subcommand writes the sentinel flag and exits 0', async () => {
    const { mkdtempSync, existsSync, rmSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');

    const dir = mkdtempSync(join(tmpdir(), 'dj-resume-'));
    try {
      const env = { ...process.env, HOME: dir };
      const r = spawnSync('node', [BIN, 'resume'], { encoding: 'utf8', env });
      assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr: ${r.stderr}`);
      const flagPath = join(dir, '.duanju-writer', 'resume.flag');
      assert.ok(existsSync(flagPath), `expected ${flagPath} to exist`);
      assert.match(readFileSync(flagPath, 'utf8'), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      assert.match(r.stdout, /Resume signal written/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('--story flag validation', () => {
  // Lazy fs imports — keep the existing tests' test-runtime cost
  function withTempFile(contents, fn) {
    const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dj-story-'));
    const f = join(dir, 'novel.md');
    writeFileSync(f, contents);
    try { return fn(f); } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  test('--story + --news rejected as mutually exclusive', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md');
    writeFileSync(f, 'x');
    try {
      const r = runCli(['run', '--story', f, '--news', 'http://example.com']);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /mutually exclusive/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--story + --style rejected as mutually exclusive', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md');
    writeFileSync(f, 'x');
    try {
      const r = runCli(['run', '--story', f, '--style', '战神归来']);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /mutually exclusive/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--fidelity without --story is rejected', () => {
    const r = runCli(['run', '--fidelity', 'tight']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /fidelity.*requires.*story/i);
  });

  test('invalid --fidelity value rejected', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md');
    writeFileSync(f, 'x');
    try {
      const r = runCli(['run', '--story', f, '--fidelity', 'extreme']);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /tight, medium, loose/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing --story file rejected', () => {
    const r = runCli(['run', '--story', '/tmp/this-file-does-not-exist-xxxx-yyyy']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /unreadable|missing/i);
  });

  test('empty --story file rejected', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md');
    writeFileSync(f, '   \n  \t');
    try {
      const r = runCli(['run', '--story', f]);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /empty/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('oversized --story file rejected (>1MB)', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md');
    writeFileSync(f, 'a'.repeat(1_100_000));
    try {
      const r = runCli(['run', '--story', f]);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /too large|1MB/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── --no-publish wiring (task: unify publish flag) ──────────────────────────
import { mkdtempSync as _mkd, rmSync as _rm } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';
import { join as _join } from 'node:path';
import { createJobIn, getJobFrom } from '../src/queue.js';

test('createJob persists publish:false and defaults to null', () => {
  const dir = _mkd(_join(_tmp(), 'pub-'));
  try {
    const jf = _join(dir, 'jobs.json');
    const j1 = createJobIn(jf, _join(dir, 'jobs'), { publish: false });
    assert.equal(getJobFrom(jf, j1.id).options.publish, false, 'explicit false must persist');
    const j2 = createJobIn(jf, _join(dir, 'jobs'), {});
    assert.equal(getJobFrom(jf, j2.id).options.publish, null, 'default must be null (= publish)');
    const j3 = createJobIn(jf, _join(dir, 'jobs'), { publish: true });
    assert.equal(getJobFrom(jf, j3.id).options.publish, null, 'explicit true normalizes to null (default)');
  } finally {
    _rm(dir, { recursive: true, force: true });
  }
});
