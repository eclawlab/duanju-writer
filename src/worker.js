import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { JOBS_DIR, WORKER_POLL_INTERVAL, MAX_RETRIES } from './constants.js';
import { loadConfig } from './config.js';
import { updateJob, getJob, claimNextPending } from './queue.js';
import { getHistory, addEntry } from './history.js';
import { collect } from './collector.js';
import { generateStory, generateOutline, generateTailOutline } from './writer.js';
import { generateSnowflake } from './snowflake.js';
import { generatePlan } from './planner.js';
import { createStore, getStoreDir } from './vectorstore.js';
import { upload } from './uploader.js';
import { logEntry, writeSummary } from './worklog.js';
import { countWords } from './enrichment.js';
import { getLLMStats, resetLLMStats } from './llm.js';

// Each job produces 3 uploads sharing a variationGroupId, one per ending type.
// Front half (≈50% of episodes) is generated once and shared; back halves diverge.
const VARIANTS = [
  { key: 'v1', ending: 'GOOD',        label: 'Good Ending' },
  { key: 'v2', ending: 'BITTERSWEET', label: 'Bittersweet Ending' },
  { key: 'v3', ending: 'SPECIAL',     label: 'Special Ending' },
];

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
  const newsUrl = options.newsUrl || '';
  const style = options.style || config.style || 'default';
  const log = (msg) => console.log(chalk.dim(`  [${jobId}] ${msg}`));
  const wlog = (event, data = {}) => { try { logEntry(jobId, event, data); } catch {} };

  const jobStartTime = Date.now();
  resetLLMStats();
  wlog('job_start', { lang, style, novelType, newsUrl });

  try {
    // ─── Step 1: Collect materials ─────────────────────────────────────────
    let materials = loadArtifact(jobId, 'materials.json');
    if (!materials) {
      updateJob(jobId, { status: 'collecting', startedAt: new Date().toISOString() });
      log(newsUrl ? `Collecting news-based research from ${newsUrl}...` : 'Collecting research materials...');
      wlog('collecting_start', newsUrl ? { newsUrl } : {});
      const history = getHistory();
      materials = await collect(history, { lang, novelType, newsUrl });
      saveArtifact(jobId, 'materials.json', materials);
      const topicCount = materials.topics.length;
      const hookCount = materials.plotHooks?.length ?? 0;
      log(`Collected ${topicCount} topics, ${hookCount} hooks`);
      wlog('collecting_done', { topics: topicCount, plotHooks: hookCount });
    } else {
      log('Resuming — materials already collected');
      wlog('collecting_resumed');
    }

    // ─── Step 2: Shared snowflake + outline + plan ─────────────────────────
    updateJob(jobId, { status: 'writing' });

    let snowflake = loadArtifact(jobId, 'snowflake.json');
    if (!snowflake) {
      try {
        log('Building story architecture (Snowflake method)...');
        snowflake = await generateSnowflake(materials, { lang, novelType, log });
        saveArtifact(jobId, 'snowflake.json', snowflake);
      } catch (err) {
        log(`[snowflake failed] ${err.message} — continuing without`);
      }
    } else {
      log('Resuming — snowflake already generated');
    }

    let baseOutline = loadArtifact(jobId, 'outline.json');
    if (!baseOutline) {
      log('Generating base story outline...');
      const enrichedMaterials = snowflake ? { ...materials, snowflake } : materials;
      baseOutline = await generateOutline(enrichedMaterials, { lang, style, novelType });
      saveArtifact(jobId, 'outline.json', baseOutline);
    } else {
      log('Resuming — outline already generated');
    }

    let basePlan = loadArtifact(jobId, 'plan.json');
    if (!basePlan) {
      try {
        log('Generating base scene plan...');
        basePlan = await generatePlan(baseOutline, { lang, novelType });
      } catch (err) {
        log(`[planning failed] ${err.message} — continuing without plan`);
        basePlan = { scenes: [], characters: [], items: [], locations: [], revelations: [] };
      }
      saveArtifact(jobId, 'plan.json', basePlan);
    } else {
      log('Resuming — plan already generated');
    }

    // ─── Step 3: Compute split point (front half = shared) ────────────────
    const sortedEpisodes = [...baseOutline.episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);
    const totalEpisodes = sortedEpisodes.length;
    const splitIdx = Math.ceil(totalEpisodes / 2);
    const frontEpisodes = sortedEpisodes.slice(0, splitIdx);
    log(`Split: ${splitIdx}/${totalEpisodes} episodes shared as front half; remaining ${totalEpisodes - splitIdx} diverge per variant.`);

    // ─── Step 4: Shared front-half scene generation ────────────────────────
    // The front is generated by calling generateStory with a truncated outline
    // (front episodes only). We capture the latest progress from onEpisode so
    // each variant can reuse the completed front episodes as a resume seed.
    const frontStorePath = getStoreDir(jobId);
    const frontStore = createStore(frontStorePath);
    frontStore.load();

    let frontProgress = loadArtifact(jobId, 'front.json');
    if (!frontProgress) {
      log(`Generating front-half scenes (episodes 0..${splitIdx - 1})...`);
      wlog('front_start', { splitIdx, totalEpisodes });
      const truncatedOutline = { ...baseOutline, episodes: frontEpisodes };
      let latestProgress = null;
      const frontStory = await generateStory(materials, {
        lang, novelType, style, log, wlog,
        vectorStore: frontStore,
        savedSnowflake: snowflake,
        savedOutline: truncatedOutline,
        savedPlan: basePlan,
        onEpisode: (pd) => {
          latestProgress = pd;
          saveArtifact(jobId, 'front.progress.json', pd);
        },
        onState: (s) => saveArtifact(jobId, 'front.state.json', s),
      });
      frontProgress = latestProgress || {
        episodes: frontStory.episodes,
        episodeContexts: {},
        globalSceneIndex: frontStory.episodes.reduce((s, ep) => s + (ep.scenes?.length || 0), 0),
      };
      saveArtifact(jobId, 'front.json', frontProgress);
      try {
        frontStore.save();
      } catch (err) {
        log(`[front vector store save failed] ${err.message} — variant retrieval may be degraded until next full run`);
        wlog('front_store_save_failed', { error: err.message });
      }
      const frontSceneCount = frontProgress.episodes.reduce((s, ep) => s + (ep.scenes?.length || 0), 0);
      log(`Front half done: ${frontProgress.episodes.length} episodes, ${frontSceneCount} scenes`);
      wlog('front_done', { episodes: frontProgress.episodes.length, scenes: frontSceneCount });
    } else {
      log(`Resuming — front half already generated (${frontProgress.episodes.length} episodes)`);
    }

    // ─── Step 5: Per-variant tail generation + upload ──────────────────────
    updateJob(jobId, { status: 'uploading' });
    const variationGroupId = `grp-${jobId}`;
    const storyIds = [];
    let sampleStory = null;
    let totalScenesAcrossVariants = 0;
    let totalWordsAcrossVariants = 0;

    for (const v of VARIANTS) {
      const uploadedKey = `upload.${v.key}.json`;
      const prior = loadArtifact(jobId, uploadedKey);
      if (prior && prior.storyId) {
        log(`Variant ${v.key} (${v.label}) already uploaded: ${prior.storyId}`);
        storyIds.push(prior.storyId);
        continue;
      }

      // Tail outline — divergent back half with target ending
      let tailOutline = loadArtifact(jobId, `tail-outline.${v.key}.json`);
      if (!tailOutline) {
        log(`Variant ${v.key}: generating ${v.ending} tail outline...`);
        wlog('tail_outline_start', { variant: v.key, ending: v.ending });
        tailOutline = await generateTailOutline(baseOutline, splitIdx, v.ending, { snowflake });
        saveArtifact(jobId, `tail-outline.${v.key}.json`, tailOutline);
        wlog('tail_outline_done', { variant: v.key, episodes: tailOutline.episodes.length });
      }

      // Full variant outline = shared front + variant tail
      const variantOutline = {
        ...baseOutline,
        episodes: [...frontEpisodes, ...tailOutline.episodes],
      };
      saveArtifact(jobId, `outline.${v.key}.json`, variantOutline);

      // Variant plan — regenerate so it covers the new tail episodes
      let variantPlan = loadArtifact(jobId, `plan.${v.key}.json`);
      if (!variantPlan) {
        try {
          log(`Variant ${v.key}: planning tail scenes...`);
          variantPlan = await generatePlan(variantOutline, { lang, novelType });
        } catch (err) {
          log(`[variant ${v.key} planning failed] ${err.message} — falling back to base plan`);
          variantPlan = basePlan;
        }
        saveArtifact(jobId, `plan.${v.key}.json`, variantPlan);
      }

      // Fork the front vector store so variants don't cross-contaminate retrieval
      const variantStorePath = join(JOBS_DIR, jobId, `vectorstore.${v.key}.json`);
      if (!existsSync(variantStorePath) && existsSync(frontStorePath)) {
        try {
          copyFileSync(frontStorePath, variantStorePath);
        } catch (err) {
          log(`[variant ${v.key}] vector store fork failed: ${err.message} — variant will start with empty retrieval`);
          wlog('variant_store_fork_failed', { variant: v.key, error: err.message });
        }
      }
      const variantStore = createStore(variantStorePath);
      variantStore.load();
      const frontSize = frontStore.size();
      const variantSize = variantStore.size();
      if (frontSize > 0 && variantSize === 0) {
        log(`[variant ${v.key}] WARNING: forked store is empty while front store has ${frontSize} entries — retrieval will be degraded`);
        wlog('variant_store_empty_after_fork', { variant: v.key, frontSize, variantSize });
      }

      // Tail scene generation. Pass front episodes via `progress` so
      // generateStory skips them and only generates the tail.
      // globalSceneIndex is reset to 0; the skip loop re-accumulates it
      // as it passes through completed front episodes.
      let variantStory = loadArtifact(jobId, `story.${v.key}.json`);
      if (!variantStory) {
        log(`Variant ${v.key}: generating ${v.ending} tail scenes...`);
        wlog('variant_scenes_start', { variant: v.key, ending: v.ending });
        const seedProgress = {
          episodes: frontProgress.episodes,
          episodeContexts: frontProgress.episodeContexts || {},
          globalSceneIndex: 0,
        };
        variantStory = await generateStory(materials, {
          lang, novelType, style, log, wlog,
          vectorStore: variantStore,
          savedSnowflake: snowflake,
          savedOutline: variantOutline,
          savedPlan: variantPlan,
          progress: seedProgress,
          onEpisode: (pd) => saveArtifact(jobId, `story.${v.key}.progress.json`, pd),
          onState: (s) => saveArtifact(jobId, `state.${v.key}.json`, s),
        });
        saveArtifact(jobId, `story.${v.key}.json`, variantStory);
        try {
          variantStore.save();
        } catch (err) {
          log(`[variant ${v.key} vector store save failed] ${err.message}`);
          wlog('variant_store_save_failed', { variant: v.key, error: err.message });
        }
      } else {
        log(`Resuming — variant ${v.key} story already generated`);
      }

      if (!sampleStory) sampleStory = variantStory;
      const vScenes = variantStory.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
      const vWords = variantStory.episodes.reduce(
        (sum, ep) => sum + ep.scenes.reduce((s, sc) => s + countWords(sc.content), 0), 0);
      totalScenesAcrossVariants += vScenes;
      totalWordsAcrossVariants += vWords;
      log(`Variant ${v.key}: "${variantStory.title}" — ${variantStory.episodes.length} eps, ${vScenes} scenes, ${vWords} words`);

      // Upload
      log(`Variant ${v.key}: uploading (${v.label})...`);
      wlog('variant_upload_start', { variant: v.key, label: v.label, variationGroupId });
      const uploadStartTime = Date.now();
      const uploadResult = await upload(variantStory, { variationGroupId, variationLabel: v.label });
      const uploadDuration = Date.now() - uploadStartTime;
      log(`Variant ${v.key} uploaded: ${uploadResult.storyId}`);
      wlog('variant_upload_done', {
        variant: v.key, storyId: uploadResult.storyId, durationMs: uploadDuration,
      });
      saveArtifact(jobId, uploadedKey, {
        storyId: uploadResult.storyId,
        title: variantStory.title,
        variationGroupId,
        variationLabel: v.label,
        ending: v.ending,
        success: uploadResult.success,
      });

      addEntry({
        topic: variantStory.title,
        genres: variantStory.genres || [],
        storyId: uploadResult.storyId,
      });

      storyIds.push(uploadResult.storyId);
    }

    // ─── Done ──────────────────────────────────────────────────────────────
    updateJob(jobId, {
      status: 'done',
      completedAt: new Date().toISOString(),
      storyIds,
      storyId: storyIds[0],
      variationGroupId,
    });

    const jobElapsedMs = Date.now() - jobStartTime;
    const llmStats = getLLMStats();
    const minutes = (jobElapsedMs / 60000).toFixed(1);
    const llmMinutes = (llmStats.totalMs / 60000).toFixed(1);
    const epsPerVariant = sampleStory?.episodes.length || 0;

    log(`\n--- Generation Report ---`);
    log(`Variations: ${storyIds.length} (group ${variationGroupId})`);
    for (let i = 0; i < VARIANTS.length && i < storyIds.length; i++) {
      log(`  ${VARIANTS[i].label}: ${storyIds[i]}`);
    }
    log(`Episodes per variant: ${epsPerVariant}, total scenes across variants: ${totalScenesAcrossVariants}, total words across variants: ${totalWordsAcrossVariants}`);
    log(`Total time: ${minutes} min (LLM time: ${llmMinutes} min)`);
    log(`LLM calls: ${llmStats.calls}`);
    if (llmStats.inputTokens || llmStats.outputTokens) {
      log(`Tokens: ${llmStats.inputTokens.toLocaleString()} input + ${llmStats.outputTokens.toLocaleString()} output = ${(llmStats.inputTokens + llmStats.outputTokens).toLocaleString()} total`);
    }
    if (llmStats.costUsd) {
      log(`Estimated cost: $${llmStats.costUsd.toFixed(4)}`);
    }
    wlog('job_done', { storyIds, variationGroupId, durationMs: jobElapsedMs, llmStats });

    const summaryLines = [
      `=== Story Writer Work Log Summary ===`,
      `Job ID:          ${jobId}`,
      `Title:           ${sampleStory?.title || '(unknown)'}`,
      `Language:        ${lang}`,
      `Type:            ${novelType || '(any)'}`,
      `News:            ${newsUrl || '(none)'}`,
      `Style:           ${style}`,
      `Variation Group: ${variationGroupId}`,
      ``,
      `--- Variations ---`,
      ...VARIANTS.map((v, i) => `${v.label.padEnd(22)} ${storyIds[i] || '(not uploaded)'}`),
      ``,
      `Episodes per variant: ${epsPerVariant}`,
      `Split point:          ${splitIdx}/${totalEpisodes} (front shared)`,
      `Scenes (total):       ${totalScenesAcrossVariants}`,
      `Words (total):        ${totalWordsAcrossVariants}`,
      ``,
      `--- LLM Usage ---`,
      `Total time:     ${minutes} min`,
      `LLM time:       ${llmMinutes} min`,
      `LLM calls:      ${llmStats.calls}`,
      `Input tokens:   ${llmStats.inputTokens.toLocaleString()}`,
      `Output tokens:  ${llmStats.outputTokens.toLocaleString()}`,
      `Total tokens:   ${(llmStats.inputTokens + llmStats.outputTokens).toLocaleString()}`,
      ...(llmStats.costUsd ? [`Est. cost:      $${llmStats.costUsd.toFixed(4)}`] : []),
      ``,
      `Detailed log: worklog.jsonl`,
    ];
    writeSummary(jobId, summaryLines);

    console.log(chalk.green(`  [${jobId}] Done — ${storyIds.length} variations published in group ${variationGroupId}`));
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
  let attempt = 0;
  while (!success) {
    const job = getJob(jobId);
    if (!job || job.status !== 'pending') break;
    attempt += 1;
    // Backoff with jitter so transient failures (rate limit, network
    // blip) don't hammer the LLM API in a tight retry loop.
    const baseMs = Math.min(30_000, 1000 * 2 ** attempt);
    const delayMs = baseMs + Math.floor(Math.random() * 1000);
    console.log(chalk.dim(`  [${jobId}] Retrying in ${Math.round(delayMs / 1000)}s...`));
    await new Promise(r => setTimeout(r, delayMs));
    success = await processJob(jobId, options);
  }
}

export function startWorker() {
  const config = loadConfig();
  console.log(chalk.cyan(`Worker started — polling for jobs (lang=${config.lang || 'en'}, type=${config.novelType || 'any'}, style=${config.style || 'default'})...`));

  let stopped = false;
  let timer = null;

  const poll = async () => {
    if (stopped) return;
    try {
      // claimNextPending atomically flips pending→collecting inside a lock
      // so a second concurrent worker can't grab the same job.
      const claimed = claimNextPending();
      if (claimed) {
        // Use options persisted on the job record so daemon-mode retries
        // reproduce the same --lang/--style/--type/--news that the job
        // was created with.
        const opts = claimed.options || {};
        await processJob(claimed.id, {
          lang: opts.lang || undefined,
          style: opts.style || undefined,
          novelType: opts.novelType || undefined,
          newsUrl: opts.newsUrl || undefined,
        });
      }
    } catch (err) {
      console.error(chalk.red(`Poll error: ${err.message}`));
    }
    if (!stopped) {
      timer = setTimeout(poll, WORKER_POLL_INTERVAL);
    }
  };

  poll();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
