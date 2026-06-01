import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression: worker's local saveArtifact() once called writeFileSync without
// importing it (the artifacts.js refactor dropped the fs import but left the
// local helper using it), so every job crashed with
//   ReferenceError: writeFileSync is not defined
// the moment it persisted its first artifact (materials.json). These tests
// drive the real save/load path to guard the symbol resolution and round-trip.

// Point DATA_DIR at a throwaway HOME before the dynamic import below: constants.js
// computes JOBS_DIR from process.env.HOME at module-load time, and node --test
// runs each test file in its own process, so this is isolated.
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'duanju-worker-artifacts-'));
process.env.HOME = FAKE_HOME;

const JOBS_DIR = join(FAKE_HOME, '.duanju-writer', 'jobs');

test('saveArtifact persists an artifact without throwing (writeFileSync regression)', async () => {
  const { saveArtifact } = await import('../src/worker.js');
  const jobId = 'job-save';
  mkdirSync(join(JOBS_DIR, jobId), { recursive: true });

  saveArtifact(jobId, 'materials.json', { topics: ['a'], plotHooks: [] });

  const path = join(JOBS_DIR, jobId, 'materials.json');
  assert.ok(existsSync(path), 'artifact file should be written');
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(onDisk.topics, ['a']);
});

test('saveArtifact tags JSON objects with the current schemaVersion', async () => {
  const { saveArtifact } = await import('../src/worker.js');
  const { SCHEMA_VERSION } = await import('../src/constants.js');
  const jobId = 'job-tag';
  mkdirSync(join(JOBS_DIR, jobId), { recursive: true });

  saveArtifact(jobId, 'outline.json', { episodes: [] });

  const onDisk = JSON.parse(readFileSync(join(JOBS_DIR, jobId, 'outline.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, SCHEMA_VERSION);
});

test('loadArtifact round-trips a saved artifact', async () => {
  const { saveArtifact, loadArtifact } = await import('../src/worker.js');
  const jobId = 'job-round';
  mkdirSync(join(JOBS_DIR, jobId), { recursive: true });

  saveArtifact(jobId, 'snowflake.json', { logline: 'x' });
  const loaded = loadArtifact(jobId, 'snowflake.json');

  assert.equal(loaded.logline, 'x');
});

test('loadArtifact returns null for a missing artifact', async () => {
  const { loadArtifact } = await import('../src/worker.js');
  assert.equal(loadArtifact('job-absent', 'nope.json'), null);
});

test.after(() => rmSync(FAKE_HOME, { recursive: true, force: true }));
