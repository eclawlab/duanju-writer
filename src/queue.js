import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { JOBS_FILE, JOBS_DIR } from './constants.js';
import { withLock } from './lock.js';

function readJobs(filePath) {
  if (!existsSync(filePath)) return [];
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    // I/O failure (permissions, disk error). Surface and abort — proceeding
    // with `[]` would let the next writeJobs overwrite the on-disk file with
    // empty, irrecoverably destroying every job record.
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`expected array, got ${typeof parsed}`);
    }
    return parsed;
  } catch (parseErr) {
    // Corrupt jobs.json. Earlier this returned [] silently — and the very
    // next writeJobs would overwrite the bad file with [], permanently
    // erasing every job record. Instead, rename the bad file aside so a
    // human can recover it, log loudly, and fail the call.
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
    const backup = `${filePath}.corrupt-${stamp}`;
    try { renameSync(filePath, backup); } catch {}
    throw new Error(
      `${filePath} is corrupt (${parseErr.message}). Renamed to ${backup}. ` +
      `Inspect or delete that file before continuing.`
    );
  }
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
    const id = makeJobId();
    // Create the artifact directory BEFORE writing the job record. The first
    // artifact write (saveArtifact in worker.js) does not mkdir; if jobs.json
    // claimed a job whose dir was missing, it would throw ENOENT and the
    // worker would burn its retry budget on an unfixable error. A kill
    // between mkdirSync and writeJobs leaves an orphan directory with no
    // record — a slow FS leak, but harmless for correctness.
    mkdirSync(join(jobsDir, id), { recursive: true });

    // Reference story content can be up to 1MB. Storing it inline in
    // jobs.json bloats every withLock round-trip (every status update reads
    // /parses /rewrites the entire jobs array). Sidecar it to the job dir
    // and store only a flag in the snapshot. Worker reads the sidecar.
    let referenceStoryFlag = null;
    if (options.referenceStory) {
      const storyPath = join(jobsDir, id, 'reference-story.txt');
      writeFileSync(storyPath, options.referenceStory, 'utf8');
      referenceStoryFlag = 'sidecar';
    }

    const job = {
      id,
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
        referenceStory: referenceStoryFlag,
        fidelity: options.fidelity ?? null,
        episodesPerDrama: options.episodesPerDrama ?? null,
        clipsPerEpisode: options.clipsPerEpisode ?? null,
        mode: options.mode ?? null,
        authorStyle: options.authorStyle ?? null,
      },
    };
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
  return jobs.some(j => ['pending', 'extracting', 'collecting', 'writing', 'uploading'].includes(j.status));
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

/**
 * Reset a single stuck job back to 'pending' so it can be re-claimed.
 * Used to recover from a SIGKILL that left a job in collecting/writing/
 * uploading state (claimJob refuses non-pending jobs, so without this
 * the only way to retry is to nuke ALL jobs).
 *
 * Returns the updated job, or null if the job doesn't exist or is in a
 * terminal state ('done' or 'failed').
 */
export function unstickJobIn(filePath, jobId) {
  return withLock(filePath, () => {
    const jobs = readJobs(filePath);
    const idx = jobs.findIndex(j => j.id === jobId);
    if (idx === -1) return null;
    const status = jobs[idx].status;
    if (status === 'done' || status === 'failed' || status === 'pending') return null;
    jobs[idx] = { ...jobs[idx], status: 'pending' };
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
export function unstickJob(id) { return unstickJobIn(JOBS_FILE, id); }
export function resetJobs() { return resetJobsIn(JOBS_FILE, JOBS_DIR); }
