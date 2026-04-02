import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { JOBS_FILE, JOBS_DIR } from './constants.js';

function readJobs(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return []; }
}

function writeJobs(filePath, jobs) {
  writeFileSync(filePath, JSON.stringify(jobs, null, 2) + '\n', 'utf8');
}

function makeJobId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const suffix = randomBytes(2).toString('hex');
  return `job_${ts}_${suffix}`;
}

export function createJobIn(filePath, jobsDir) {
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
  };
  jobs.push(job);
  writeJobs(filePath, jobs);
  mkdirSync(join(jobsDir, job.id), { recursive: true });
  return job;
}

export function updateJobIn(filePath, jobId, updates) {
  const jobs = readJobs(filePath);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) throw new Error(`Job not found: ${jobId}`);
  jobs[idx] = { ...jobs[idx], ...updates };
  writeJobs(filePath, jobs);
  return jobs[idx];
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

export function createJob() { return createJobIn(JOBS_FILE, JOBS_DIR); }
export function updateJob(id, updates) { return updateJobIn(JOBS_FILE, id, updates); }
export function getJob(id) { return getJobFrom(JOBS_FILE, id); }
export function listJobs() { return listJobsFrom(JOBS_FILE); }
export function hasBusyJob() { return hasBusyJobIn(JOBS_FILE); }
