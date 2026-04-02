import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '.test_scheduler');
const JOBS_FILE = join(TEST_DIR, 'jobs.json');
const JOBS_DIR = join(TEST_DIR, 'jobs');

describe('scheduler internals', () => {
  // We can't directly test startScheduler (it starts intervals),
  // but we can test the queue interaction pattern it uses.

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(JOBS_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('hasBusyJob prevents creating new jobs when one is in progress', async () => {
    const { createJobIn, hasBusyJobIn } = await import('../src/queue.js');

    // Simulates the scheduler tick guard
    assert.equal(hasBusyJobIn(JOBS_FILE), false);
    createJobIn(JOBS_FILE, JOBS_DIR);
    assert.equal(hasBusyJobIn(JOBS_FILE), true);
  });

  test('scheduler creates a job when queue is idle', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn, listJobsFrom } = await import('../src/queue.js');

    // All done — scheduler should create
    const job = createJobIn(JOBS_FILE, JOBS_DIR);
    updateJobIn(JOBS_FILE, job.id, { status: 'done' });
    assert.equal(hasBusyJobIn(JOBS_FILE), false);

    // Scheduler tick creates a new job
    const newJob = createJobIn(JOBS_FILE, JOBS_DIR);
    assert.equal(newJob.status, 'pending');
    const jobs = listJobsFrom(JOBS_FILE);
    assert.equal(jobs.length, 2);
  });

  test('duplicate pending detection pattern', async () => {
    const { createJobIn, listJobsFrom } = await import('../src/queue.js');

    // Simulates the race condition check in scheduler tick
    createJobIn(JOBS_FILE, JOBS_DIR);
    createJobIn(JOBS_FILE, JOBS_DIR);
    const pending = listJobsFrom(JOBS_FILE).filter(j => j.status === 'pending');
    assert.ok(pending.length > 1); // This triggers the "duplicate pending" guard
  });
});
