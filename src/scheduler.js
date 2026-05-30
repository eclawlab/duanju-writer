import { loadConfig } from './config.js';
import { createJob } from './queue.js';
import { hasBusyJob } from './queue.js';
import { readFileSync } from 'node:fs';
import { DEFAULT_HEARTBEAT_INTERVAL } from './constants.js';
import chalk from 'chalk';

// Resolve a reference file from config to its CONTENT — NOT its path.
// processJob treats options.referenceCharacter/Event/Story as the literal text
// to inject (it logs `.length` and feeds it into prompts), exactly as `bin run`
// passes it. Passing a path here would inject the path string as the reference.
// Returns null when unset or unreadable (warned), so the job simply runs
// without that reference rather than failing. Resolved per-tick so a file
// appearing/disappearing between heartbeats is reflected.
function resolveRefContent(label, path) {
  if (!path) return null;
  try {
    const content = readFileSync(path, 'utf8');
    if (!content.trim()) {
      console.warn(chalk.yellow(`[scheduler] ${label} file is empty: ${path} — skipping it this tick`));
      return null;
    }
    return content;
  } catch (err) {
    console.warn(chalk.yellow(`[scheduler] ${label} file unreadable: ${path} (${err.message}) — skipping it this tick`));
    return null;
  }
}

export function startScheduler() {
  const config = loadConfig();
  const interval = config.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL;
  console.log(chalk.cyan(`Scheduler started — heartbeat every ${Math.round(interval / 1000)}s`));

  let stopped = false;
  let timer = null;

  const tick = () => {
    if (stopped) return;
    try {
      const cfg = loadConfig();
      if (hasBusyJob()) {
        console.log(chalk.dim('[scheduler] a job is already pending/in-flight — skipping this tick'));
      } else {
        // Scalar fields use `|| undefined` so createJob's `?? null` normalizes
        // them — matching the daemon-poll job-option shape in worker.js. The
        // reference fields are resolved to content (see resolveRefContent).
        const jobOptions = {
          lang: cfg.lang || undefined,
          genre: cfg.genre || undefined,
          style: cfg.style || undefined,
          episodesPerDrama: cfg.episodesPerDrama || undefined,
          clipsPerEpisode: cfg.clipsPerEpisode || undefined,
          mode: cfg.mode || undefined,
          authorStyle: cfg.authorStyle || undefined,
          fidelity: cfg.fidelity || undefined,
          referenceCharacter: resolveRefContent('referenceCharacter', cfg.referenceCharacter),
          referenceEvent: resolveRefContent('referenceEvent', cfg.referenceEvent),
          referenceStory: resolveRefContent('referenceStory', cfg.referenceStory),
        };
        const job = createJob(jobOptions);
        console.log(chalk.dim(`[scheduler] created job ${job.id}`));
      }
    } catch (err) {
      console.error(chalk.red(`[scheduler] tick error: ${err.message}`));
    }
    if (!stopped) {
      timer = setTimeout(tick, interval);
    }
  };

  tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
