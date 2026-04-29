import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, rmSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { JOBS_FILE, JOBS_DIR } from './constants.js';

const LOCK_STALE_MS = 30_000;
const LOCK_MAX_ATTEMPTS = 100;
const LOCK_SLEEP_MS = 20;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function withLock(filePath, fn) {
  const lockPath = filePath + '.lock';
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {}
      sleepSync(LOCK_SLEEP_MS);
      continue;
    }
    try { return fn(); }
    finally {
      try { closeSync(fd); } catch {}
      try { unlinkSync(lockPath); } catch {}
    }
  }
  throw new Error(`Could not acquire lock on ${filePath}`);
}

function readJobs(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return []; }
}

function writeJobs(filePath, jobs) {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(2).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(jobs, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function makeJobId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const suffix = randomBytes(2).toString('hex');
  return `job_${ts}_${suffix}`;
}

export function createJobIn(filePath, jobsDir, options = {}) {
  return withLock(filePath, () => {
    const jobs = readJobs(filePath);
    const job = {
      id: makeJobId(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retries: 0,
      storyId: null,
      error: null,
      options: {
        lang: options.lang ?? null,
        style: options.style ?? null,
        genre: options.genre ?? null,
        newsUrl: options.newsUrl ?? null,
        referenceCharacter: options.referenceCharacter ?? null,
        referenceEvent: options.referenceEvent ?? null,
      },
    };
    mkdirSync(join(jobsDir, job.id), { recursive: true });
    jobs.push(job);
    writeJobs(filePath, jobs);
    return job;
  });
}

export function updateJobIn(filePath, jobId, updates) {
  return withLock(filePath, () => {
    const jobs = readJobs(filePath);
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx === -1) throw new Error(`Job not found: ${jobId}`);
    jobs[idx] = { ...jobs[idx], ...updates };
    writeJobs(filePath, jobs);
    return jobs[idx];
  });
}

export function getJobFrom(filePath, jobId) {
  const jobs = readJobs(filePath);
  return jobs.find(j => j.id === jobId) || null;
}

export function listJobsFrom(filePath) {
  return readJobs(filePath);
}

export function hasBusyJobIn(filePath) {
  const jobs = readJobs(filePath);
  return jobs.some(j => ['pending', 'collecting', 'writing', 'uploading'].includes(j.status));
}

/**
 * Atomically claim the next pending job by flipping its status to 'collecting'
 * inside a single lock. Returns the claimed job, or null if no pending job
 * exists. Prevents two concurrent workers from double-grabbing the same job.
 */
export function claimNextPendingIn(filePath) {
  return withLock(filePath, () => {
    const jobs = readJobs(filePath);
    const idx = jobs.findIndex(j => j.status === 'pending');
    if (idx === -1) return null;
    jobs[idx] = {
      ...jobs[idx],
      status: 'collecting',
      startedAt: jobs[idx].startedAt || new Date().toISOString(),
    };
    writeJobs(filePath, jobs);
    return jobs[idx];
  });
}

/**
 * Atomically claim a specific job by id. Used by `runOnce` so a CLI invocation
 * can't race a daemon worker that's already grabbed the same job. Returns the
 * claimed job on success; returns null if the job doesn't exist or is no
 * longer pending (already claimed by another process).
 */
export function claimJobIn(filePath, jobId) {
  return withLock(filePath, () => {
    const jobs = readJobs(filePath);
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx === -1) return null;
    if (jobs[idx].status !== 'pending') return null;
    jobs[idx] = {
      ...jobs[idx],
      status: 'collecting',
      startedAt: jobs[idx].startedAt || new Date().toISOString(),
    };
    writeJobs(filePath, jobs);
    return jobs[idx];
  });
}

export function resetJobsIn(filePath, jobsDir) {
  return withLock(filePath, () => {
    const prior = readJobs(filePath);
    const priorCount = prior.length;

    // Remove every job directory under jobsDir. Keep jobsDir itself.
    if (existsSync(jobsDir)) {
      for (const entry of readdirSync(jobsDir)) {
        try { rmSync(join(jobsDir, entry), { recursive: true, force: true }); } catch {}
      }
    } else {
      mkdirSync(jobsDir, { recursive: true });
    }

    writeJobs(filePath, []);
    return { priorCount };
  });
}

export function createJob(options = {}) { return createJobIn(JOBS_FILE, JOBS_DIR, options); }
export function updateJob(id, updates) { return updateJobIn(JOBS_FILE, id, updates); }
export function getJob(id) { return getJobFrom(JOBS_FILE, id); }
export function listJobs() { return listJobsFrom(JOBS_FILE); }
export function hasBusyJob() { return hasBusyJobIn(JOBS_FILE); }
export function claimNextPending() { return claimNextPendingIn(JOBS_FILE); }
export function claimJob(id) { return claimJobIn(JOBS_FILE, id); }
export function resetJobs() { return resetJobsIn(JOBS_FILE, JOBS_DIR); }
