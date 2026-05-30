import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { JOBS_DIR } from './constants.js';
import { generateDrama, generateTailOutline, validateOutlineChapterCoverage } from './drama-writer.js';
import { generatePlan } from './planner.js';
import { createStore } from './vectorstore.js';
import { upload } from './uploader.js';

/**
 * Generate one ending-variant of a drama: divergent tail outline → assembled
 * variant outline → variant plan → forked vector store → tail clip generation →
 * (optional) upload with idempotency. Extracted from worker.processJob's
 * per-variant loop so that function stays legible; behavior is unchanged.
 *
 * ctx (all supplied by the caller):
 *   jobId, publish, variationGroupId,
 *   baseOutline, splitIdx, frontEpisodes, frontProgress, frontStore,
 *   snowflake, materials, bible, chapters, fidelity,
 *   genre, lang, style, mode, authorStyle, referenceCharacter, referenceEvent,
 *   log, wlog, saveArtifact, loadArtifact, computeStoryMetrics
 *
 * @param {{key:string,ending:string,label:string}} v - variant descriptor
 * @returns {Promise<{ storyId: string|null, story: object|null, clips: number, words: number }>}
 *   storyId is null when publishing is disabled (the story is still generated +
 *   persisted, just not uploaded). story is null only when a previously-uploaded
 *   variant's cached story artifact is missing on resume.
 */
export async function generateVariant(v, ctx) {
  const {
    jobId, publish, variationGroupId,
    baseOutline, splitIdx, frontEpisodes, frontProgress, frontStore,
    snowflake, materials, bible, chapters, fidelity,
    genre, lang, style, mode, authorStyle, referenceCharacter, referenceEvent,
    log, wlog, saveArtifact, loadArtifact, computeStoryMetrics,
  } = ctx;

  const uploadedKey = `upload.${v.key}.json`;
  const prior = publish ? loadArtifact(jobId, uploadedKey) : null;
  if (prior && prior.storyId) {
    log(`Variant ${v.key} (${v.label}) already uploaded: ${prior.storyId}`);
    // Fold the cached variant's clip/word totals into the summary counters —
    // earlier the resume path silently dropped them, so a job that completed via
    // multiple runOnce calls reported totals only for the final-run variants.
    const cachedStory = loadArtifact(jobId, `story.${v.key}.json`);
    if (cachedStory) {
      const { clips, words } = computeStoryMetrics(cachedStory);
      return { storyId: prior.storyId, story: cachedStory, clips, words };
    }
    return { storyId: prior.storyId, story: null, clips: 0, words: 0 };
  }

  // Tail outline — divergent back half with target ending
  let tailOutline = loadArtifact(jobId, `tail-outline.${v.key}.json`);
  if (!tailOutline) {
    log(`Variant ${v.key}: generating ${v.ending} tail outline...`);
    wlog('tail_outline_start', { variant: v.key, ending: v.ending });
    const totalChaptersForTail = chapters ? chapters.chapters.length : 0;
    tailOutline = await generateTailOutline(baseOutline, splitIdx, v.ending, {
      snowflake,
      lang,
      genre,
      referenceCharacter,
      referenceEvent,
      newsSource: materials?.newsSource || null,
      bible,
      fidelity,
      totalChapters: totalChaptersForTail,
      mode,
      log,
    });
    saveArtifact(jobId, `tail-outline.${v.key}.json`, tailOutline);
    wlog('tail_outline_done', { variant: v.key, episodes: tailOutline.episodes.length });
  }

  // Full variant outline = shared front + variant tail
  const variantOutline = {
    ...baseOutline,
    episodes: [...frontEpisodes, ...tailOutline.episodes],
  };
  // Re-validate full-coverage chapter range for the assembled variant outline
  // under tight fidelity. The base outline passed validation pre-split, but the
  // tail LLM may have skipped chapters.
  if (bible && fidelity === 'tight') {
    const totalChaptersForVariant = chapters ? chapters.chapters.length : 0;
    validateOutlineChapterCoverage(variantOutline, fidelity, totalChaptersForVariant);
  }
  saveArtifact(jobId, `outline.${v.key}.json`, variantOutline);

  // Variant plan — regenerate so it covers the new tail episodes
  let variantPlan = loadArtifact(jobId, `plan.${v.key}.json`);
  if (!variantPlan) {
    let variantPlanSucceeded = false;
    try {
      log(`Variant ${v.key}: planning tail clips...`);
      const aggregateChapterRange = chapters && chapters.chapters.length ? [1, chapters.chapters.length] : null;
      variantPlan = await generatePlan(variantOutline, { lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, aggregateChapterRange, mode });
      variantPlanSucceeded = true;
    } catch (err) {
      log(`[variant ${v.key} planning failed] ${err.message} — falling back to empty skeleton; will retry on next run`);
      // basePlan was generated for the original outline (different ending).
      // Reusing it here would feed wrong-ending sceneMap entries into the
      // variant's tail clips. Empty skeleton means clips run without plan
      // augmentation — degraded but not actively wrong.
      variantPlan = { clips: [], characters: [], items: [], locations: [], revelations: [] };
    }
    if (variantPlanSucceeded) saveArtifact(jobId, `plan.${v.key}.json`, variantPlan);
  }

  // Fork the front vector store so variants don't cross-contaminate retrieval.
  // store.fork() writes the in-memory front entries directly to the variant
  // path, so it can't clone a stale on-disk snapshot or come up empty (the two
  // failure modes the old re-save + copyFileSync dance had to guard against).
  // On resume, the variant store already exists — load it.
  const variantStorePath = join(JOBS_DIR, jobId, `vectorstore.${v.key}.json`);
  let variantStore;
  if (existsSync(variantStorePath)) {
    variantStore = createStore(variantStorePath);
    variantStore.load();
  } else {
    try {
      variantStore = frontStore.fork(variantStorePath);
    } catch (err) {
      log(`[variant ${v.key}] vector store fork failed: ${err.message} — variant will start with empty retrieval`);
      wlog('variant_store_fork_failed', { variant: v.key, error: err.message });
      variantStore = createStore(variantStorePath);
      variantStore.load();
    }
  }
  const frontSize = frontStore.size();
  const variantSize = variantStore.size();
  if (frontSize > 0 && variantSize === 0) {
    log(`[variant ${v.key}] WARNING: forked store is empty while front store has ${frontSize} entries — retrieval will be degraded`);
    wlog('variant_store_empty_after_fork', { variant: v.key, frontSize, variantSize });
  }

  // Tail scene generation. Pass front episodes via `progress` so generateDrama
  // skips them and only generates the tail. globalClipIndex is reset to 0; the
  // skip loop re-accumulates it as it passes through completed front episodes.
  let variantStory = loadArtifact(jobId, `story.${v.key}.json`);
  if (!variantStory) {
    log(`Variant ${v.key}: generating ${v.ending} tail clips...`);
    wlog('variant_clips_start', { variant: v.key, ending: v.ending });
    const seedProgress = {
      episodes: frontProgress.episodes,
      episodeContexts: frontProgress.episodeContexts || {},
      globalClipIndex: 0,
    };
    variantStory = await generateDrama(materials, {
      lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, style, mode, authorStyle, log, wlog,
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

  const { clips: vClips, words: vWords } = computeStoryMetrics(variantStory);
  log(`Variant ${v.key}: "${variantStory.title}" — ${variantStory.episodes.length} eps, ${vClips} clips, ${vWords} words`);

  // Generation-only mode: skip the upload entirely. The story artifact is
  // already persisted above, so a later run without --no-publish can upload it.
  if (!publish) {
    log(`Variant ${v.key}: generated (not uploaded — publishing disabled).`);
    wlog('variant_upload_skipped', { variant: v.key });
    return { storyId: null, story: variantStory, clips: vClips, words: vWords };
  }

  // Upload — write a "pending" artifact with the idempotency key BEFORE the HTTP
  // call so a crash between request-success and artifact-save doesn't produce a
  // duplicate platform story on retry. The platform is expected to honor the
  // Idempotency-Key header / body field and return the same storyId for repeated
  // POSTs with the same key.
  const idempotencyKey = `${jobId}.${v.key}`;
  const pendingKey = `upload.${v.key}.pending.json`;
  // If a previous attempt already started an upload for this variant, the pending
  // artifact records the idempotency key and (after first response) the storyId.
  // On retry, the platform should return the same storyId for the same key — log
  // loudly if it changes (signals the platform didn't honor idempotency).
  const priorPending = loadArtifact(jobId, pendingKey);
  // Shared fields for both the pre-upload and post-upload pending writes; only
  // the storyId differs (null before the call, real id after).
  const pendingBase = {
    idempotencyKey, variationGroupId, variationLabel: v.label, ending: v.ending,
    startedAt: priorPending?.startedAt || new Date().toISOString(),
    attempts: (priorPending?.attempts || 0) + 1,
  };
  saveArtifact(jobId, pendingKey, { ...pendingBase, priorStoryId: priorPending?.storyId || null });
  log(`Variant ${v.key}: uploading (${v.label})...`);
  wlog('variant_upload_start', { variant: v.key, label: v.label, variationGroupId, idempotencyKey, retryAttempt: priorPending?.attempts || 0 });
  const uploadStartTime = Date.now();
  const uploadResult = await upload(variantStory, {
    variationGroupId,
    variationLabel: v.label,
    idempotencyKey,
  });
  const uploadDuration = Date.now() - uploadStartTime;
  if (priorPending?.storyId && priorPending.storyId !== uploadResult.storyId) {
    log(chalk.red(`[variant ${v.key}] DUPLICATE UPLOAD: previous attempt produced storyId=${priorPending.storyId}, retry returned ${uploadResult.storyId}. Platform did not honor Idempotency-Key=${idempotencyKey}.`));
    wlog('variant_upload_duplicate_detected', {
      variant: v.key, idempotencyKey,
      priorStoryId: priorPending.storyId,
      newStoryId: uploadResult.storyId,
    });
  }
  // Persist the storyId in the pending artifact so a future retry can detect
  // duplicates (above check) even after a crash before the final saveArtifact.
  saveArtifact(jobId, pendingKey, { ...pendingBase, storyId: uploadResult.storyId });
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
    idempotencyKey,
    success: uploadResult.success,
  });

  return { storyId: uploadResult.storyId, story: variantStory, clips: vClips, words: vWords };
}
