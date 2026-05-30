import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'duanju-writer.js');
const run = (args) => {
  try {
    return { out: execFileSync('node', [BIN, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
};

test('knowledge info runs (regression: storePath was out of scope → ReferenceError)', () => {
  const r = run(['knowledge', 'info']);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  assert.match(r.out, /Knowledge base: \d+ entries/);
  assert.match(r.out, /Store path:/);
});

test('knowledge with --job resolves a per-job store path', () => {
  const r = run(['knowledge', 'info', '--job', 'job_test_xyz']);
  assert.equal(r.code, 0);
  assert.match(r.out, /jobs[/\\]job_test_xyz[/\\]vectorstore\.json/);
});

test('provider list and role list run via extracted handlers', () => {
  assert.equal(run(['provider', 'list']).code, 0);
  const role = run(['role', 'list']);
  assert.equal(role.code, 0);
  assert.match(role.out, /Role assignments/);
});

test('unknown sub prints usage (provider/role/knowledge)', () => {
  assert.match(run(['provider']).out, /Usage: duanju-writer provider/);
  assert.match(run(['role']).out, /Usage: duanju-writer role/);
  assert.match(run(['knowledge']).out, /Usage: duanju-writer knowledge/);
});
