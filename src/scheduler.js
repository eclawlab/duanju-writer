import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { loadConfig } from './config.js';
import { createJob, listJobs } from './queue.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from './constants.js';

function formatInterval(ms) {
  const mins = Math.round(ms / 60000);
  return mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`;
}

function resolveReferenceFile(label, filePath) {
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, 'utf8');
    if (!content.trim()) {
      console.log(chalk.yellow(`[scheduler] Reference ${label} file "${filePath}" is empty — ignoring`));
      return null;
    }
    return content;
  } catch (err) {
    console.log(chalk.yellow(`[scheduler] Reference ${label} file "${filePath}" unreadable: ${err.message} — ignoring`));
    return null;
  }
}

function tick() {
  const jobs = listJobs();
  const busy = jobs.some(j => ['pending', 'collecting', 'writing', 'uploading'].includes(j.status));
  if (busy) {
    console.log(chalk.dim(`[scheduler] Skipping — busy job in queue`));
    return;
  }

  // Snapshot option content at tick time so scheduler-created jobs match the
  // per-job immutability guarantees of CLI-created jobs: editing or deleting a
  // reference file between heartbeat and worker execution cannot mutate a job
  // that is already queued.
  const config = loadConfig();

  // If the user configured a reference file but it isn't readable RIGHT NOW,
  // skip this tick rather than silently creating a job without the
  // constraint. (Earlier behavior dropped the constraint and proceeded —
  // dramas would generate without the reference character/event the user
  // had committed to in config.) Wait for the next heartbeat so a transient
  // FS issue (network mount blip, vim swap file) gets a retry.
  const charContent = config.referenceCharacter
    ? resolveReferenceFile('character', config.referenceCharacter)
    : null;
  if (config.referenceCharacter && !charContent) {
    console.log(chalk.yellow(`[scheduler] Skipping tick — referenceCharacter "${config.referenceCharacter}" unresolved.`));
    return;
  }
  const eventContent = config.referenceEvent
    ? resolveReferenceFile('event', config.referenceEvent)
    : null;
  if (config.referenceEvent && !eventContent) {
    console.log(chalk.yellow(`[scheduler] Skipping tick — referenceEvent "${config.referenceEvent}" unresolved.`));
    return;
  }

  const options = {
    lang: config.lang || undefined,
    style: config.style || undefined,
    genre: config.genre || undefined,
    referenceCharacter: charContent || undefined,
    referenceEvent: eventContent || undefined,
  };

  const job = createJob(options);
  console.log(chalk.cyan(`[scheduler] Created job ${job.id}`));
}

export function startScheduler() {
  const config = loadConfig();
  const interval = config.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL;

  console.log(chalk.cyan(`Scheduler started — heartbeat every ${formatInterval(interval)}`));

  // Run immediately on start
  tick();

  // Then on interval
  const handle = setInterval(tick, interval);

  return {
    stop() {
      clearInterval(handle);
    },
  };
}
