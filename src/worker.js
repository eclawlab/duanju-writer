import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { JOBS_DIR, WORKER_POLL_INTERVAL, MAX_RETRIES } from './constants.js';
import { loadConfig } from './config.js';
import { listJobs, updateJob, getJob } from './queue.js';
import { getHistory, addEntry } from './history.js';
import { collect } from './collector.js';
import { generateStory } from './writer.js';
import { upload } from './uploader.js';

export function getStatusTransitions() {
  return [
    { from: 'pending', to: 'collecting' },
    { from: 'collecting', to: 'writing' },
    { from: 'writing', to: 'uploading' },
    { from: 'uploading', to: 'done' },
  ];
}

function saveArtifact(jobId, filename, data) {
  const dir = join(JOBS_DIR, jobId);
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadArtifact(jobId, filename) {
  const filePath = join(JOBS_DIR, jobId, filename);
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

async function processJob(jobId, options = {}) {
  const config = loadConfig();
  const maxRetries = config.maxRetries || MAX_RETRIES;
  const lang = options.lang || config.lang || 'en';
  const style = options.style || config.style || 'default';
  const log = (msg) => console.log(chalk.dim(`  [${jobId}] ${msg}`));

  try {
    // Step 1: Collect (resume if materials already saved)
    let materials = loadArtifact(jobId, 'materials.json');
    if (!materials) {
      updateJob(jobId, { status: 'collecting', startedAt: new Date().toISOString() });
      log('Collecting research materials...');
      const history = getHistory();
      materials = await collect(history, { lang });
      saveArtifact(jobId, 'materials.json', materials);
      log(`Collected ${materials.topics.length} topics, ${materials.plotHooks?.length ?? 0} hooks`);
    } else {
      log('Resuming — materials already collected');
    }

    // Step 2: Write (resume if story already saved)
    let story = loadArtifact(jobId, 'story.json');
    if (!story) {
      updateJob(jobId, { status: 'writing' });
      story = await generateStory(materials, {
        lang,
        style,
        log,
        onOutline: (outline) => saveArtifact(jobId, 'outline.json', outline),
        onPlan: (plan) => saveArtifact(jobId, 'plan.json', plan),
        onState: (state) => saveArtifact(jobId, 'state.json', state),
      });
      saveArtifact(jobId, 'story.json', story);
      log(`Generated "${story.title}" (${story.episodes[0]?.scenes?.length || 0} scenes)`);
    } else {
      log(`Resuming — story "${story.title}" already generated`);
    }

    // Step 3: Upload
    updateJob(jobId, { status: 'uploading' });
    log('Uploading to autostory...');
    const result = await upload(story);
    saveArtifact(jobId, 'result.json', result);
    log(`Uploaded! Story ID: ${result.storyId}`);

    // Done
    updateJob(jobId, {
      status: 'done',
      completedAt: new Date().toISOString(),
      storyId: result.storyId,
    });

    // Track in history
    addEntry({
      topic: story.title,
      genres: story.genres || [],
      storyId: result.storyId,
    });

    console.log(chalk.green(`  [${jobId}] Done — "${story.title}" published`));
    return true;
  } catch (err) {
    const job = getJob(jobId);
    const retries = (job?.retries || 0) + 1;
    console.log(chalk.red(`  [${jobId}] Failed: ${err.message}`));

    if (retries < maxRetries) {
      updateJob(jobId, { status: 'pending', retries, error: err.message });
      console.log(chalk.yellow(`  [${jobId}] Will retry (${retries}/${maxRetries})`));
    } else {
      updateJob(jobId, { status: 'failed', retries, error: err.message, completedAt: new Date().toISOString() });
      console.log(chalk.red(`  [${jobId}] Max retries reached — giving up`));
    }
    return false;
  }
}

export async function runOnce(jobId, options = {}) {
  let success = await processJob(jobId, options);
  while (!success) {
    const job = getJob(jobId);
    if (!job || job.status !== 'pending') break;
    console.log(chalk.dim(`  [${jobId}] Retrying...`));
    success = await processJob(jobId, options);
  }
}

export function startWorker() {
  const config = loadConfig();
  console.log(chalk.cyan(`Worker started — polling for jobs (lang=${config.lang || 'en'}, style=${config.style || 'default'})...`));

  const poll = async () => {
    try {
      const jobs = listJobs();
      const pending = jobs.find(j => j.status === 'pending');
      if (pending) {
        await processJob(pending.id);
      }
    } catch (err) {
      console.error(chalk.red(`Poll error: ${err.message}`));
    }
    setTimeout(poll, WORKER_POLL_INTERVAL);
  };

  poll();
}
