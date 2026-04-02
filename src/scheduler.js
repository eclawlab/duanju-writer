import chalk from 'chalk';
import { loadConfig } from './config.js';
import { createJob, listJobs } from './queue.js';
import { DEFAULT_HEARTBEAT_INTERVAL } from './constants.js';

function formatInterval(ms) {
  const mins = Math.round(ms / 60000);
  return mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`;
}

function tick() {
  const jobs = listJobs();
  const busy = jobs.some(j => ['pending', 'collecting', 'writing', 'uploading'].includes(j.status));
  if (busy) {
    console.log(chalk.dim(`[scheduler] Skipping — busy job in queue`));
    return;
  }

  const job = createJob();
  console.log(chalk.cyan(`[scheduler] Created job ${job.id}`));
}

export function startScheduler() {
  const config = loadConfig();
  const interval = config.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL;

  console.log(chalk.cyan(`Scheduler started — heartbeat every ${formatInterval(interval)}`));

  // Run immediately on start
  tick();

  // Then on interval
  setInterval(tick, interval);
}
