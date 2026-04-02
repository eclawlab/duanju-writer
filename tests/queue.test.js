import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '.test_queue');
const JOBS_FILE = join(TEST_DIR, 'jobs.json');
const JOBS_DIR = join(TEST_DIR, 'jobs');

describe('queue', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(JOBS_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('createJobIn adds a pending job with correct structure', async () => {
    const { createJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    assert.match(job.id, /^job_\d{14}_[0-9a-f]{4}$/);
    assert.equal(job.status, 'pending');
    assert.equal(job.retries, 0);
    assert.equal(job.storyId, null);
    assert.equal(job.error, null);
    assert.equal(job.startedAt, null);
    assert.equal(job.completedAt, null);
    assert.ok(job.createdAt);
  });

  test('createJobIn creates a directory for the job', async () => {
    const { createJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    assert.ok(existsSync(join(JOBS_DIR, job.id)));
  });

  test('createJobIn persists job to file', async () => {
    const { createJobIn, listJobsFrom } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    const jobs = listJobsFrom(JOBS_FILE);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, job.id);
  });

  test('createJobIn generates unique IDs', async () => {
    const { createJobIn } = await import('../src/queue.js');
    const job1 = createJobIn(JOBS_FILE, JOBS_DIR);
    const job2 = createJobIn(JOBS_FILE, JOBS_DIR);
    assert.notEqual(job1.id, job2.id);
  });

  test('updateJobIn changes job fields', async () => {
    const { createJobIn, updateJobIn, getJobFrom } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'collecting', startedAt: '2024-01-01T00:00:00Z' });
    const updated = getJobFrom(JOBS_FILE, job.id);
    assert.equal(updated.status, 'collecting');
    assert.equal(updated.startedAt, '2024-01-01T00:00:00Z');
  });

  test('updateJobIn returns the updated job', async () => {
    const { createJobIn, updateJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    const updated = updateJobIn(JOBS_FILE, job.id, { status: 'writing' });
    assert.equal(updated.status, 'writing');
    assert.equal(updated.id, job.id);
  });

  test('updateJobIn throws on unknown job ID', async () => {
    const { createJobIn, updateJobIn } = await import('../src/queue.js');
    createJobIn(JOBS_FILE, JOBS_DIR);
    assert.throws(() => updateJobIn(JOBS_FILE, 'nonexistent_id', { status: 'done' }), /Job not found: nonexistent_id/);
  });

  test('getJobFrom returns null for missing job', async () => {
    const { createJobIn, getJobFrom } = await import('../src/queue.js');
    createJobIn(JOBS_FILE, JOBS_DIR);
    const result = getJobFrom(JOBS_FILE, 'nonexistent');
    assert.equal(result, null);
  });

  test('listJobsFrom returns empty array when no file', async () => {
    const { listJobsFrom } = await import('../src/queue.js');
    const jobs = listJobsFrom(join(TEST_DIR, 'missing.json'));
    assert.deepEqual(jobs, []);
  });

  test('listJobsFrom returns empty array for invalid JSON', async () => {
    const { listJobsFrom } = await import('../src/queue.js');
    writeFileSync(JOBS_FILE, 'bad json', 'utf8');
    const jobs = listJobsFrom(JOBS_FILE);
    assert.deepEqual(jobs, []);
  });

  test('listJobsFrom returns all jobs', async () => {
    const { createJobIn, listJobsFrom } = await import('../src/queue.js');
    createJobIn(JOBS_FILE, JOBS_DIR);
    createJobIn(JOBS_FILE, JOBS_DIR);
    createJobIn(JOBS_FILE, JOBS_DIR);
    const jobs = listJobsFrom(JOBS_FILE);
    assert.equal(jobs.length, 3);
  });

  test('hasBusyJobIn returns true for pending status', async () => {
    const { createJobIn, hasBusyJobIn } = await import('../src/queue.js');
    createJobIn(JOBS_FILE, JOBS_DIR);
    assert.equal(hasBusyJobIn(JOBS_FILE), true);
  });

  test('hasBusyJobIn returns true for collecting status', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'collecting' });
    assert.equal(hasBusyJobIn(JOBS_FILE), true);
  });

  test('hasBusyJobIn returns true for writing status', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'writing' });
    assert.equal(hasBusyJobIn(JOBS_FILE), true);
  });

  test('hasBusyJobIn returns true for uploading status', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'uploading' });
    assert.equal(hasBusyJobIn(JOBS_FILE), true);
  });

  test('hasBusyJobIn returns false when all jobs are done', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'done' });
    assert.equal(hasBusyJobIn(JOBS_FILE), false);
  });

  test('hasBusyJobIn returns false for failed jobs', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'failed' });
    assert.equal(hasBusyJobIn(JOBS_FILE), false);
  });

  test('hasBusyJobIn returns false when no jobs file', async () => {
    const { hasBusyJobIn } = await import('../src/queue.js');
    assert.equal(hasBusyJobIn(join(TEST_DIR, 'nope.json')), false);
  });

  test('hasBusyJobIn detects busy among mixed statuses', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const job1 = createJobIn(JOBS_FILE, JOBS_DIR);
    const job2 = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job1.id, { status: 'done' });
    updateJobIn(JOBS_FILE, job2.id, { status: 'failed' });
    assert.equal(hasBusyJobIn(JOBS_FILE), false);

    const job3 = createJobIn(JOBS_FILE, JOBS_DIR);
    // job3 is pending
    assert.equal(hasBusyJobIn(JOBS_FILE), true);
  });
});
