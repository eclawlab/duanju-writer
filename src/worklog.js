import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOBS_DIR } from './constants.js';

function getLogPath(jobId) {
  return join(JOBS_DIR, jobId, 'worklog.jsonl');
}

function timestamp() {
  return new Date().toISOString();
}

/**
 * Append a structured log entry to the job's worklog.
 * Each line is a self-contained JSON object (JSONL format).
 */
export function logEntry(jobId, event, data = {}) {
  const entry = { ts: timestamp(), event, ...data };
  const logPath = getLogPath(jobId);
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Write a human-readable summary at the end of the job.
 */
export function writeSummary(jobId, lines) {
  const summaryPath = join(JOBS_DIR, jobId, 'worklog-summary.txt');
  writeFileSync(summaryPath, lines.join('\n') + '\n', 'utf8');
}
