import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { JOBS_DIR, WORKER_POLL_INTERVAL, MAX_RETRIES } from './constants.js';
import { loadConfig } from './config.js';
import { listJobs, updateJob, getJob } from './queue.js';
import { getHistory, addEntry } from './history.js';
import { collect } from './collector.js';
import { generateStory } from './writer.js';
import { createStore, getStoreDir } from './vectorstore.js';
import { upload, fetchStory, verifyChoices } from './uploader.js';
import { logEntry, writeSummary } from './worklog.js';

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
  const novelType = options.novelType || config.novelType || '';
  const style = options.style || config.style || 'default';
  const log = (msg) => console.log(chalk.dim(`  [${jobId}] ${msg}`));
  const wlog = (event, data = {}) => { try { logEntry(jobId, event, data); } catch {} };

  wlog('job_start', { lang, style, novelType });

  try {
    // Step 1: Collect (resume if materials already saved)
    let materials = loadArtifact(jobId, 'materials.json');
    if (!materials) {
      updateJob(jobId, { status: 'collecting', startedAt: new Date().toISOString() });
      log('Collecting research materials...');
      wlog('collecting_start');
      const history = getHistory();
      materials = await collect(history, { lang, novelType });
      saveArtifact(jobId, 'materials.json', materials);
      const topicCount = materials.topics.length;
      const hookCount = materials.plotHooks?.length ?? 0;
      log(`Collected ${topicCount} topics, ${hookCount} hooks`);
      wlog('collecting_done', { topics: topicCount, plotHooks: hookCount });
    } else {
      log('Resuming — materials already collected');
      wlog('collecting_resumed');
    }

    // Initialize vector store for this job
    const storePath = getStoreDir(jobId);
    const vectorStore = createStore(storePath);
    vectorStore.load(); // Load existing data if resuming

    // Step 2: Write (resume if story already saved)
    let story = loadArtifact(jobId, 'story.json');
    if (!story) {
      updateJob(jobId, { status: 'writing' });

      // Check for partial progress from a previous interrupted run
      const progress = loadArtifact(jobId, 'progress.json');
      const savedOutline = loadArtifact(jobId, 'outline.json');
      const savedPlan = loadArtifact(jobId, 'plan.json');
      const savedSnowflake = loadArtifact(jobId, 'snowflake.json');
      if (progress) {
        log(`Resuming — ${progress.episodes?.length || 0} episode(s) already written`);
        wlog('writing_resume', { completedEpisodes: progress.episodes?.length || 0 });
      } else {
        wlog('writing_start');
      }

      story = await generateStory(materials, {
        lang,
        novelType,
        style,
        log,
        wlog,
        vectorStore,
        progress,
        savedOutline,
        savedPlan,
        savedSnowflake,
        onSnowflake: (snowflake) => saveArtifact(jobId, 'snowflake.json', snowflake),
        onOutline: (outline) => {
          saveArtifact(jobId, 'outline.json', outline);
          const totalEpisodes = outline.episodes.length;
          const endingCount = outline.episodes.filter(ep => ep.isEnding).length;
          const totalScenes = outline.episodes.reduce((sum, ep) => sum + ep.scenePlan.length, 0);
          const totalChoices = outline.episodes.reduce((sum, ep) => sum + (ep.episodeChoices?.length || 0), 0);
          wlog('outline_generated', {
            title: outline.title,
            episodes: totalEpisodes,
            endings: endingCount,
            scenes: totalScenes,
            choices: totalChoices,
          });
        },
        onPlan: (plan) => {
          saveArtifact(jobId, 'plan.json', plan);
          wlog('plan_generated', {
            scenesPlanned: plan.scenes?.length || 0,
            revelations: plan.revelations?.length || 0,
            plotArcs: plan.plotArcs?.length || 0,
            foreshadowing: plan.foreshadowing?.length || 0,
          });
        },
        onState: (state) => saveArtifact(jobId, 'state.json', state),
        onEpisode: (progressData) => saveArtifact(jobId, 'progress.json', progressData),
      });
      saveArtifact(jobId, 'story.json', story);
      // Save vector store
      try { vectorStore.save(); } catch {}
      const totalEpScenes = story.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
      const totalWords = story.episodes.reduce((sum, ep) =>
        sum + ep.scenes.reduce((s, sc) => s + (sc.content?.split(/\s+/).length || 0), 0), 0);
      const totalChoicesGenerated = story.episodes.reduce((sum, ep) =>
        sum + ep.scenes.reduce((s, sc) => s + (sc.choices?.length || 0) + (sc.episodeChoices?.length || 0), 0), 0);
      log(`Generated "${story.title}" (${story.episodes.length} episodes, ${totalEpScenes} scenes)`);
      wlog('writing_done', {
        title: story.title,
        episodes: story.episodes.length,
        scenes: totalEpScenes,
        totalWords,
        totalChoices: totalChoicesGenerated,
        episodeDetails: story.episodes.map(ep => ({
          index: ep.episodeIndex,
          title: ep.title,
          isEnding: ep.isEnding,
          scenes: ep.scenes.length,
          words: ep.scenes.reduce((s, sc) => s + (sc.content?.split(/\s+/).length || 0), 0),
          choices: ep.episodeChoices?.length || 0,
        })),
      });
    } else {
      log(`Resuming — story "${story.title}" already generated`);
      wlog('writing_resumed', { title: story.title });
    }

    // Step 3: Upload (resume if result already saved)
    let result = loadArtifact(jobId, 'result.json');
    if (!result) {
      updateJob(jobId, { status: 'uploading' });
      log('Uploading to autostory...');
      wlog('upload_start', { autostoryUrl: config.autostoryUrl });
      const uploadStartTime = Date.now();
      result = await upload(story);
      const uploadDuration = Date.now() - uploadStartTime;
      saveArtifact(jobId, 'result.json', result);
      log(`Uploaded! Story ID: ${result.storyId}`);
      wlog('upload_done', {
        success: result.success,
        storyId: result.storyId,
        durationMs: uploadDuration,
      });
    } else {
      log(`Resuming — already uploaded (Story ID: ${result.storyId})`);
      wlog('upload_resumed', { storyId: result.storyId });
    }

    // Step 4: Verify uploaded choices match local story
    log('Verifying uploaded choices...');
    wlog('verify_start', { storyId: result.storyId });
    try {
      const remoteStory = await fetchStory(result.storyId);
      const verification = verifyChoices(story, remoteStory);
      saveArtifact(jobId, 'verify.json', verification);
      if (verification.ok) {
        log(`Verified — all choices match across ${verification.episodes.length} episodes`);
        wlog('verify_done', { ok: true, episodes: verification.episodes.length });
      } else {
        const failed = verification.episodes.filter(e => e.status !== 'OK');
        log(`[verify warning] ${failed.length} episode(s) have choice mismatches`);
        for (const ep of failed) {
          log(`  [${ep.episodeIndex}] "${ep.title}": ${ep.detail}`);
        }
        wlog('verify_done', {
          ok: false,
          episodes: verification.episodes.length,
          mismatches: failed.map(e => ({ episodeIndex: e.episodeIndex, detail: e.detail })),
        });
      }
    } catch (verifyErr) {
      log(`[verify failed] ${verifyErr.message}`);
      wlog('verify_error', { error: verifyErr.message });
    }

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

    wlog('job_done', { storyId: result.storyId, title: story.title });

    // Write human-readable summary
    const totalScenes = story.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
    const totalWords = story.episodes.reduce((sum, ep) =>
      sum + ep.scenes.reduce((s, sc) => s + (sc.content?.split(/\s+/).length || 0), 0), 0);
    const totalChoices = story.episodes.reduce((sum, ep) =>
      sum + ep.scenes.reduce((s, sc) => s + (sc.choices?.length || 0) + (sc.episodeChoices?.length || 0), 0), 0);
    writeSummary(jobId, [
      `=== Story Writer Work Log Summary ===`,
      `Job ID:    ${jobId}`,
      `Title:     ${story.title}`,
      `Story ID:  ${result.storyId}`,
      `Language:  ${lang}`,
      `Type:      ${novelType || '(any)'}`,
      `Style:     ${style}`,
      ``,
      `--- Statistics ---`,
      `Episodes:  ${story.episodes.length}`,
      `Scenes:    ${totalScenes}`,
      `Words:     ${totalWords}`,
      `Choices:   ${totalChoices}`,
      ``,
      `--- Episodes ---`,
      ...story.episodes.map(ep => {
        const epWords = ep.scenes.reduce((s, sc) => s + (sc.content?.split(/\s+/).length || 0), 0);
        const epChoices = ep.episodeChoices?.length || 0;
        return `  [${ep.episodeIndex}] "${ep.title}" — ${ep.scenes.length} scenes, ${epWords} words, ${epChoices} choices${ep.isEnding ? ' (ending: ' + ep.ending + ')' : ''}`;
      }),
      ``,
      `--- Upload ---`,
      `Status:    ${result.success ? 'SUCCESS' : 'FAILED'}`,
      `Story ID:  ${result.storyId}`,
      `Server:    ${config.autostoryUrl}`,
      ``,
      `--- Verification ---`,
      ...((() => {
        const v = loadArtifact(jobId, 'verify.json');
        if (!v) return ['Status:    SKIPPED (verify failed or not run)'];
        if (v.ok) return [`Status:    PASSED — all choices verified across ${v.episodes.length} episodes`];
        const failed = v.episodes.filter(e => e.status !== 'OK');
        return [`Status:    FAILED — ${failed.length} episode(s) with mismatches`, ...failed.map(e => `  [${e.episodeIndex}] ${e.detail}`)];
      })()),
      ``,
      `Detailed log: worklog.jsonl`,
    ]);

    console.log(chalk.green(`  [${jobId}] Done — "${story.title}" published`));
    return true;
  } catch (err) {
    const job = getJob(jobId);
    const retries = (job?.retries || 0) + 1;
    console.log(chalk.red(`  [${jobId}] Failed: ${err.message}`));
    wlog('job_error', { error: err.message, retries });

    if (retries < maxRetries) {
      updateJob(jobId, { status: 'pending', retries, error: err.message });
      console.log(chalk.yellow(`  [${jobId}] Will retry (${retries}/${maxRetries})`));
    } else {
      updateJob(jobId, { status: 'failed', retries, error: err.message, completedAt: new Date().toISOString() });
      console.log(chalk.red(`  [${jobId}] Max retries reached — giving up`));
      wlog('job_failed', { error: err.message, retries });
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
  console.log(chalk.cyan(`Worker started — polling for jobs (lang=${config.lang || 'en'}, type=${config.novelType || 'any'}, style=${config.style || 'default'})...`));

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
