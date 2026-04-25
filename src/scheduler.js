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
  const options = {
    lang: config.lang || undefined,
    style: config.style || undefined,
    novelType: config.novelType || undefined,
    referenceCharacter: resolveReferenceFile('character', config.referenceCharacter) || undefined,
    referenceEvent: resolveReferenceFile('event', config.referenceEvent) || undefined,
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
