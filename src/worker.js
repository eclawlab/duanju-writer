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
import { countWords } from './enrichment.js';
import { getLLMStats, resetLLMStats } from './llm.js';
import { findAllPaths, pickBestPaths, linearizeOutline } from './path-picker.js';

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
    // Step 1: Collect (resume if materials already saved)
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

    // Initialize vector store for this job
    const storePath = getStoreDir(jobId);
    const vectorStore = createStore(storePath);
    vectorStore.load(); // Load existing data if resuming

    // Step 2: Generate branching outline (shared across all variations)
    updateJob(jobId, { status: 'writing' });

    // Generate outline via a single generateStory call that we'll interrupt after outline
    // Or reuse saved artifacts from previous runs
    const savedOutline = loadArtifact(jobId, 'outline.json');
    const savedSnowflake = loadArtifact(jobId, 'snowflake.json');
    let savedPaths = loadArtifact(jobId, 'paths.json');

    // If we don't have an outline yet, generate one by doing a full story generation
    // that we capture the outline from via the callback
    let outline = savedOutline;
    let snowflakeData = savedSnowflake;
    if (!outline) {
      wlog('writing_start');
      // Generate the full branching story first to get outline + snowflake
      const fullStory = await generateStory(materials, {
        lang,
        novelType,
        style,
        log,
        wlog,
        vectorStore,
        savedSnowflake: snowflakeData,
        onSnowflake: (sf) => { snowflakeData = sf; saveArtifact(jobId, 'snowflake.json', sf); },
        onOutline: (ol) => { outline = ol; saveArtifact(jobId, 'outline.json', ol); },
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
      // Save the full branching story as reference
      saveArtifact(jobId, 'story-full.json', fullStory);
      try { vectorStore.save(); } catch {}
    } else {
      log('Resuming — outline already generated');
    }

    const allPaths = findAllPaths(outline);
    log(`Found ${allPaths.length} possible paths through the story tree`);

    // Step 3: Pick best 3 paths using LLM
    if (!savedPaths) {
      log('Selecting best 3 story variations...');
      wlog('path_picking_start', { totalPaths: allPaths.length });
      savedPaths = await pickBestPaths(outline, lang);
      saveArtifact(jobId, 'paths.json', savedPaths);
      for (let p = 0; p < savedPaths.length; p++) {
        const pathEps = savedPaths[p].map(idx => {
          const ep = outline.episodes.find(e => e.episodeIndex === idx);
          return ep ? `"${ep.title}"` : `#${idx}`;
        });
        log(`  Path ${p + 1}: ${pathEps.join(' → ')}`);
      }
      wlog('path_picking_done', { paths: savedPaths.length, pathDetails: savedPaths });
    } else {
      log(`Resuming — ${savedPaths.length} paths already selected`);
    }

    // Step 4: Generate, upload, and verify each variation
    const variationResults = loadArtifact(jobId, 'variations.json') || [];
    const storyIds = [];

    for (let v = 0; v < savedPaths.length; v++) {
      const varLabel = `variation-${v + 1}`;
      const path = savedPaths[v];

      // Check if this variation is already done
      const existingResult = variationResults[v];
      if (existingResult && existingResult.storyId) {
        log(`Variation ${v + 1}/${savedPaths.length}: already uploaded (Story ID: ${existingResult.storyId})`);
        storyIds.push(existingResult.storyId);
        continue;
      }

      log(`\n=== Variation ${v + 1}/${savedPaths.length} ===`);
      wlog('variation_start', { variation: v + 1, path });

      // Linearize the outline for this path
      const linearOutline = linearizeOutline(outline, path);
      const pathEpTitles = linearOutline.episodes.map(ep => ep.title).join(' → ');
      log(`Path: ${pathEpTitles}`);

      // Add variation suffix to title
      const endingEp = linearOutline.episodes[linearOutline.episodes.length - 1];
      const endingType = endingEp?.ending || 'NEUTRAL';
      linearOutline.title = `${outline.title}（线路${v + 1}·${endingType === 'GOOD' ? '好' : endingType === 'BAD' ? '坏' : endingType === 'SPECIAL' ? '特殊' : '中性'}结局）`;
      if (lang !== 'cn') {
        linearOutline.title = `${outline.title} (Path ${v + 1} · ${endingType} Ending)`;
      }

      // Generate this variation's story using the linearized outline
      const varVectorStore = createStore(getStoreDir(jobId) + `-var${v + 1}`);

      let varStory = loadArtifact(jobId, `story-${varLabel}.json`);
      if (!varStory) {
        const savedPlan = loadArtifact(jobId, 'plan.json');
        const varProgress = loadArtifact(jobId, `progress-${varLabel}.json`);

        varStory = await generateStory(materials, {
          lang,
          novelType,
          style,
          log: (msg) => log(`[V${v + 1}] ${msg}`),
          wlog: (event, data = {}) => wlog(`var${v + 1}_${event}`, data),
          vectorStore: varVectorStore,
          progress: varProgress,
          savedOutline: linearOutline,
          savedPlan,
          savedSnowflake: snowflakeData,
          onSnowflake: () => {}, // already have it
          onOutline: () => {}, // already have it
          onPlan: () => {}, // already have it
          onState: (state) => saveArtifact(jobId, `state-${varLabel}.json`, state),
          onEpisode: (progressData) => saveArtifact(jobId, `progress-${varLabel}.json`, progressData),
        });
        saveArtifact(jobId, `story-${varLabel}.json`, varStory);
        try { varVectorStore.save(); } catch {}
      } else {
        log(`[V${v + 1}] Resuming — story already generated`);
      }

      const varScenes = varStory.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
      const varWords = varStory.episodes.reduce((sum, ep) =>
        sum + ep.scenes.reduce((s, sc) => s + countWords(sc.content), 0), 0);
      log(`[V${v + 1}] "${varStory.title}" — ${varStory.episodes.length} episodes, ${varScenes} scenes, ${varWords} words`);

      // Upload this variation
      let varResult = existingResult;
      if (!varResult || !varResult.storyId) {
        log(`[V${v + 1}] Uploading...`);
        wlog(`var${v + 1}_upload_start`, { autostoryUrl: config.autostoryUrl });
        const uploadStartTime = Date.now();
        const endingLabel = endingType === 'GOOD' ? (lang === 'cn' ? '好结局' : 'Good Ending')
          : endingType === 'BAD' ? (lang === 'cn' ? '坏结局' : 'Bad Ending')
          : endingType === 'SPECIAL' ? (lang === 'cn' ? '特殊结局' : 'Special Ending')
          : (lang === 'cn' ? '中性结局' : 'Neutral Ending');
        varResult = await upload(varStory, {
          variationGroupId: jobId,
          variationLabel: lang === 'cn' ? `线路${v + 1}·${endingLabel}` : `Path ${v + 1} · ${endingLabel}`,
        });
        const uploadDuration = Date.now() - uploadStartTime;
        log(`[V${v + 1}] Uploaded! Story ID: ${varResult.storyId}`);
        wlog(`var${v + 1}_upload_done`, { success: varResult.success, storyId: varResult.storyId, durationMs: uploadDuration });

        // Save progress
        variationResults[v] = { storyId: varResult.storyId, title: varStory.title, success: varResult.success };
        saveArtifact(jobId, 'variations.json', variationResults);
      }
      storyIds.push(varResult.storyId);

      // Verify this variation
      try {
        const remoteStory = await fetchStory(varResult.storyId);
        const verification = verifyChoices(varStory, remoteStory);
        saveArtifact(jobId, `verify-${varLabel}.json`, verification);
        if (verification.ok) {
          log(`[V${v + 1}] Verified — all episodes match`);
        } else {
          const failed = verification.episodes.filter(e => e.status !== 'OK');
          log(`[V${v + 1}] [verify warning] ${failed.length} episode(s) have mismatches`);
        }
      } catch (verifyErr) {
        log(`[V${v + 1}] [verify failed] ${verifyErr.message}`);
      }

      // Track in history
      addEntry({
        topic: varStory.title,
        genres: varStory.genres || [],
        storyId: varResult.storyId,
      });

      wlog('variation_done', { variation: v + 1, storyId: varResult.storyId, title: varStory.title });
    }

    // Done
    updateJob(jobId, {
      status: 'done',
      completedAt: new Date().toISOString(),
      storyId: storyIds.join(','),
    });

    // ─── Generation stats ───────────────────────────────────────────────
    const jobElapsedMs = Date.now() - jobStartTime;
    const llmStats = getLLMStats();
    const minutes = (jobElapsedMs / 60000).toFixed(1);
    const llmMinutes = (llmStats.totalMs / 60000).toFixed(1);
    log(`\n--- Generation Report ---`);
    log(`Variations: ${savedPaths.length}`);
    log(`Story IDs: ${storyIds.join(', ')}`);
    log(`Total time: ${minutes} min (LLM time: ${llmMinutes} min)`);
    log(`LLM calls: ${llmStats.calls}`);
    if (llmStats.inputTokens || llmStats.outputTokens) {
      log(`Tokens: ${llmStats.inputTokens.toLocaleString()} input + ${llmStats.outputTokens.toLocaleString()} output = ${(llmStats.inputTokens + llmStats.outputTokens).toLocaleString()} total`);
    }
    if (llmStats.costUsd) {
      log(`Estimated cost: $${llmStats.costUsd.toFixed(4)}`);
    }
    wlog('job_done', {
      storyIds,
      variations: variationResults,
      durationMs: jobElapsedMs,
      llmStats,
    });

    // Write human-readable summary
    const summaryLines = [
      `=== Story Writer Work Log Summary ===`,
      `Job ID:    ${jobId}`,
      `Title:     ${outline.title}`,
      `Language:  ${lang}`,
      `Type:      ${novelType || '(any)'}`,
      `News:      ${newsUrl || '(none)'}`,
      `Style:     ${style}`,
      ``,
      `--- Variations (${savedPaths.length}) ---`,
    ];
    for (let v = 0; v < variationResults.length; v++) {
      const vr = variationResults[v];
      const varStory = loadArtifact(jobId, `story-variation-${v + 1}.json`);
      if (varStory) {
        const varScenes = varStory.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
        const varWords = varStory.episodes.reduce((sum, ep) =>
          sum + ep.scenes.reduce((s, sc) => s + countWords(sc.content), 0), 0);
        summaryLines.push(`  [${v + 1}] "${vr.title}" — ${varStory.episodes.length} episodes, ${varScenes} scenes, ${varWords} words — Story ID: ${vr.storyId}`);
      } else {
        summaryLines.push(`  [${v + 1}] "${vr?.title || '?'}" — Story ID: ${vr?.storyId || '?'}`);
      }
    }
    summaryLines.push(
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
    );
    writeSummary(jobId, summaryLines);

    console.log(chalk.green(`  [${jobId}] Done — ${savedPaths.length} variations published: ${storyIds.join(', ')}`));
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
