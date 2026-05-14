import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { JOBS_DIR, WORKER_POLL_INTERVAL, MAX_RETRIES, SCHEMA_VERSION } from './constants.js';
import { loadConfig } from './config.js';
import { updateJob, getJob, claimNextPending, claimJob, unstickJob } from './queue.js';
import { getHistory, addEntry } from './history.js';
import { collect } from './collector.js';
import { generateDrama, generateOutline, generateTailOutline, validateOutlineChapterCoverage } from './drama-writer.js';
import { generateSnowflake } from './snowflake.js';
import { generatePlan } from './planner.js';
import {
  splitChapters,
  extractChapterFacts,
  synthesizeBible,
  loadStoryArtifacts,
  saveStoryArtifacts,
} from './story-bible.js';
import { createStore, getStoreDir } from './vectorstore.js';
import { upload } from './uploader.js';
import { logEntry, writeSummary } from './worklog.js';
import { countWords } from './enrichment.js';
import { getLLMStats, resetLLMStats } from './llm.js';

// Each job produces 3 uploads sharing a variationGroupId, one per ending type.
// Front half (≈50% of episodes) is generated once and shared; back halves diverge.
const VARIANTS = [
  { key: 'v1', ending: '爽爆',     label: '爽爆结局' },
  { key: 'v2', ending: '苦尽甘来', label: '苦尽甘来结局' },
  { key: 'v3', ending: '反转',     label: '反转结局' },
];

// Static description of valid status edges in the pipeline. Informational
// only — the actual transitions are driven by claimNextPending (pending →
// collecting, unconditionally) and processJob (which then flips to
// 'extracting' when referenceStory is set, otherwise straight to 'writing').
export function getStatusTransitions() {
  return [
    { from: 'pending', to: 'collecting' },
    { from: 'collecting', to: 'extracting' },
    { from: 'collecting', to: 'writing' },
    { from: 'extracting', to: 'writing' },
    { from: 'writing', to: 'uploading' },
    { from: 'uploading', to: 'done' },
  ];
}

function saveArtifact(jobId, filename, data) {
  const dir = join(JOBS_DIR, jobId);
  // Tag JSON-object artifacts with schemaVersion so the loader can refuse to
  // resume jobs whose artifacts predate this pivot. Arrays and primitives pass
  // through untouched. Spread `data` first so the literal SCHEMA_VERSION wins
  // over any stale schemaVersion already present (re-saving a previously
  // loaded artifact must update the tag, not preserve the old one).
  const tagged = (data && typeof data === 'object' && !Array.isArray(data))
    ? { ...data, schemaVersion: SCHEMA_VERSION }
    : data;
  writeFileSync(join(dir, filename), JSON.stringify(tagged, null, 2) + '\n', 'utf8');
}

function loadArtifact(jobId, filename) {
  const filePath = join(JOBS_DIR, jobId, filename);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    // Reject mismatched schema versions: a stale (v1) artifact would silently
    // produce garbage if fed into the new (v2) pipeline. Log loudly and treat
    // as missing so the worker regenerates from the latest valid upstream stage.
    if (data && typeof data === 'object' && !Array.isArray(data) && data.schemaVersion !== SCHEMA_VERSION) {
      console.log(chalk.yellow(`  [${jobId}] Artifact "${filename}" has schemaVersion=${data.schemaVersion} (expected ${SCHEMA_VERSION}) — will regenerate`));
      return null;
    }
    return data;
  } catch (err) {
    // Corrupt artifact (e.g., half-written after process kill). Log loudly so it's
    // not silently skipped, and return null so the caller re-runs that stage.
    console.log(chalk.yellow(`  [${jobId}] Artifact "${filename}" is corrupt (${err.message}) — will regenerate`));
    return null;
  }
}

/**
 * Build a minimal `materials` shape from a bible so downstream stages
 * (which expect materials.topics/plotHooks/...) keep working when trend
 * research is skipped. synthesizeBible only validates characters+events
 * non-empty; hooks and themes may be missing if the LLM omits them — the
 * `?? []` guards keep .map from throwing.
 * @param {object} bible
 * @returns {{topics: Array, plotHooks: Array, characterArchetypes: Array, trendingTropes: Array}}
 */
export function synthMaterialsFromBible(bible) {
  return {
    topics: (bible.themes ?? []).map((t) => ({ topic: t, source: 'bible' })),
    plotHooks: (bible.hooks ?? []).map((h) => ({ hook: h.summary, source: 'bible' })),
    characterArchetypes: (bible.characters ?? []).map((c) => ({ archetype: c.role, identity: c.identity })),
    trendingTropes: [],
  };
}

/**
 * Splits a novel, extracts per-chapter facts via LLM, synthesizes the bible,
 * and persists both artifacts. Skips work and returns existing artifacts when
 * a valid bible.json + chapters.json already exist for the jobDir.
 * @param {object} opts - { jobDir, storyText, llmFn?, log? }
 * @returns {Promise<{bible, chapters, isFresh}>}
 *   isFresh=false when artifacts were reloaded from disk (resume); the caller
 *   must NOT mutate the returned bible — it's already canonical. isFresh=true
 *   when this call performed extraction; the caller may still attach
 *   reference-pinned entries before re-saving.
 */
export async function extractStoryArtifacts({ jobDir, storyText, llmFn, log = () => {} }) {
  const existing = loadStoryArtifacts(jobDir);
  if (existing) {
    log('Story artifacts present — reusing');
    return { ...existing, isFresh: false };
  }
  const chapterChunks = splitChapters(storyText, { log });
  log(`Split novel into ${chapterChunks.length} chapter chunks`);
  const facts = [];
  let degradedChapters = 0;
  for (const chunk of chapterChunks) {
    let f;
    try {
      f = await extractChapterFacts(chunk, { llmFn });
    } catch (err) {
      // One LLM-side malformation shouldn't abort the whole bible. Retry
      // once with a corrective hint, then fall back to a stub. The
      // synthesizer enforces non-empty characters/events globally, so a
      // single empty chapter is recoverable as long as other chapters
      // produce content.
      log(`[bible] chapter ${chunk.chapterIndex} extraction failed: ${err.message} — retrying once`);
      try {
        f = await extractChapterFacts(chunk, { llmFn, strict: true });
      } catch (err2) {
        log(`[bible] chapter ${chunk.chapterIndex} retry failed: ${err2.message} — skipping with empty stub`);
        degradedChapters += 1;
        f = { chapterIndex: chunk.chapterIndex, characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
      }
    }
    facts.push(f);
  }
  if (degradedChapters > 0) {
    log(`[bible] ${degradedChapters} of ${chapterChunks.length} chapters extracted as empty stubs`);
  }
  let bible;
  try {
    bible = await synthesizeBible(facts, { llmFn, sourceTitle: '' });
  } catch (err) {
    // Same recovery shape as the per-chapter loop: one strict-mode retry
    // before letting the job-level retryTransient kick in. The synthesis
    // step is the most expensive call in bible-extraction (full ChapterFacts
    // round-trip), so a cheap in-place retry is worth the extra LLM hit.
    log(`[bible] synthesis failed: ${err.message} — retrying once with strict mode`);
    bible = await synthesizeBible(facts, { llmFn, sourceTitle: '', strict: true });
  }
  const totalChars = chapterChunks.reduce((sum, c) => sum + c.prose.length, 0);
  const chapters = {
    schemaVersion: 1,
    totalChars,
    chapters: chapterChunks.map(c => ({ chapterIndex: c.chapterIndex, title: c.title, charCount: c.prose.length, prose: c.prose })),
  };
  saveStoryArtifacts(jobDir, { bible, chapters });
  log(`Story bible: ${bible.characters.length} characters, ${bible.events.length} events`);
  return { bible, chapters, isFresh: true };
}

// Downstream artifacts that depend on the story bible. When a fresh bible is
// synthesized on a job that previously ran without --story (or with a stale
// bible), these must be invalidated so the bible-aware prompts re-generate them.
const BIBLE_DEPENDENT_ARTIFACTS = [
  'snowflake.json',
  'outline.json',
  'plan.json',
  'front.json',
  'front.progress.json',
  'front.state.json',
];

export function invalidateBibleDependentArtifacts(jobId, log = () => {}, opts = {}) {
  const jobDir = opts.jobDir || join(JOBS_DIR, jobId);
  const removed = [];
  for (const name of BIBLE_DEPENDENT_ARTIFACTS) {
    const p = join(jobDir, name);
    if (existsSync(p)) {
      try { unlinkSync(p); removed.push(name); } catch (err) {
        log(`[bible-invalidate] failed to remove ${name}: ${err.message}`);
      }
    }
  }
  // Variant artifacts: outline.v*.json, plan.v*.json, tail-outline.v*.json,
  // story.v*.json, story.v*.progress.json, state.v*.json
  for (const v of VARIANTS) {
    for (const name of [
      `outline.${v.key}.json`,
      `plan.${v.key}.json`,
      `tail-outline.${v.key}.json`,
      `story.${v.key}.json`,
      `story.${v.key}.progress.json`,
      `state.${v.key}.json`,
    ]) {
      const p = join(jobDir, name);
      if (existsSync(p)) {
        try { unlinkSync(p); removed.push(name); } catch (err) {
          log(`[bible-invalidate] failed to remove ${name}: ${err.message}`);
        }
      }
    }
  }
  if (removed.length) {
    log(`Fresh bible synthesized — invalidated ${removed.length} stale artifact(s): ${removed.join(', ')}`);
  }
  return removed.length;
}

async function processJob(jobId, options = {}) {
  const config = loadConfig();
  const maxRetries = config.maxRetries || MAX_RETRIES;
  const lang = options.lang || config.lang || 'cn';
  const genre = options.genre || config.genre || '';
  const newsUrl = options.newsUrl || '';
  const style = options.style || config.style || 'default';
  const episodesPerDrama = options.episodesPerDrama || config.episodesPerDrama || 20;
  const clipsPerEpisode = options.clipsPerEpisode || config.clipsPerEpisode || 6;
  // Reference character/event: prefer snapshotted content from job options; otherwise read config path.
  let referenceCharacter = options.referenceCharacter || '';
  if (!referenceCharacter && config.referenceCharacter) {
    try {
      referenceCharacter = readFileSync(config.referenceCharacter, 'utf8');
    } catch (err) {
      console.log(chalk.yellow(`  [${jobId}] Reference character file "${config.referenceCharacter}" unreadable: ${err.message} — continuing without`));
      referenceCharacter = '';
    }
  }
  let referenceEvent = options.referenceEvent || '';
  if (!referenceEvent && config.referenceEvent) {
    try {
      referenceEvent = readFileSync(config.referenceEvent, 'utf8');
    } catch (err) {
      console.log(chalk.yellow(`  [${jobId}] Reference event file "${config.referenceEvent}" unreadable: ${err.message} — continuing without`));
      referenceEvent = '';
    }
  }
  // referenceStory may arrive as: (a) full text content (legacy / direct CLI
  // bypass of createJob), (b) the literal sentinel 'sidecar' meaning the
  // content is stored at <jobDir>/reference-story.txt, or (c) empty.
  let referenceStory = options.referenceStory || '';
  if (referenceStory === 'sidecar') {
    const sidecar = join(JOBS_DIR, jobId, 'reference-story.txt');
    try {
      referenceStory = readFileSync(sidecar, 'utf8');
    } catch (err) {
      console.log(chalk.yellow(`  [${jobId}] Reference story sidecar "${sidecar}" unreadable: ${err.message} — continuing without`));
      referenceStory = '';
    }
  }
  if (!referenceStory && config.referenceStory) {
    try {
      referenceStory = readFileSync(config.referenceStory, 'utf8');
    } catch (err) {
      console.log(chalk.yellow(`  [${jobId}] Reference story file "${config.referenceStory}" unreadable: ${err.message} — continuing without`));
      referenceStory = '';
    }
  }
  const fidelity = options.fidelity || config.fidelity || 'medium';
  const mode = options.mode || config.mode || 'default';
  const log = (msg) => console.log(chalk.dim(`  [${jobId}] ${msg}`));
  const wlog = (event, data = {}) => { try { logEntry(jobId, event, data); } catch {} };

  const jobStartTime = Date.now();
  resetLLMStats();
  wlog('job_start', {
    lang, style, genre, newsUrl,
    referenceCharacter: referenceCharacter ? `${referenceCharacter.length} chars` : '(none)',
    referenceEvent: referenceEvent ? `${referenceEvent.length} chars` : '(none)',
    referenceStory: referenceStory ? `${referenceStory.length} chars` : '(none)',
    fidelity,
    mode,
  });

  try {
    // ─── Step 0: Story extraction (only when --story is set) ───────────────
    let bible = null;
    let chapters = null;
    const jobDir = join(JOBS_DIR, jobId);
    if (referenceStory) {
      updateJob(jobId, { status: 'extracting', startedAt: new Date().toISOString() });
      log('Extracting story bible from reference novel...');
      wlog('story_extract_start', { storyChars: referenceStory.length });
      let isFresh;
      ({ bible, chapters, isFresh } = await extractStoryArtifacts({ jobDir, storyText: referenceStory, log }));
      // Reference-pinned merge: only when the bible was just synthesized.
      // On resume, the saved bible already contains any pinned entries from
      // the prior run — re-pushing duplicates them.
      if (isFresh) {
        if (referenceCharacter && referenceCharacter.trim()) {
          bible.characters.push({
            name: '指定角色',
            role: 'reference-pinned',
            identity: referenceCharacter.slice(0, 80),
            motivation: '指定参考',
            arc: '指定参考',
            firstChapter: 1,
            lastChapter: chapters.chapters.length,
          });
        }
        if (referenceEvent && referenceEvent.trim()) {
          bible.events.push({
            eventIndex: bible.events.length,
            summary: referenceEvent.slice(0, 120),
            chapterRange: [1, chapters.chapters.length],
            actors: [],
            isTurningPoint: true,
            isReveal: false,
          });
        }
        saveStoryArtifacts(jobDir, { bible, chapters });
        // A fresh bible invalidates any prior bible-unaware downstream
        // artifacts (e.g. when --story was added to a job that already ran
        // once without it, or when the schema-version-bumped reload threw
        // out the bible but kept downstream artifacts).
        invalidateBibleDependentArtifacts(jobId, log);
      }
      wlog('story_extract_done', { chapters: chapters.chapters.length, charactersInBible: bible.characters.length, events: bible.events.length, isFresh });
    }

    // ─── Step 1: Collect materials (skipped when bible is present) ─────────
    let materials = loadArtifact(jobId, 'materials.json');
    if (!materials && !bible) {
      updateJob(jobId, { status: 'collecting', startedAt: new Date().toISOString() });
      log(newsUrl ? `Collecting news-based research from ${newsUrl}...` : 'Collecting research materials...');
      wlog('collecting_start', newsUrl ? { newsUrl } : {});
      const history = getHistory();
      materials = await collect(history, { lang, genre, newsUrl });
      saveArtifact(jobId, 'materials.json', materials);
      const topicCount = materials.topics.length;
      const hookCount = materials.plotHooks?.length ?? 0;
      log(`Collected ${topicCount} topics, ${hookCount} hooks`);
      wlog('collecting_done', { topics: topicCount, plotHooks: hookCount });
    } else if (!materials && bible) {
      materials = synthMaterialsFromBible(bible);
      saveArtifact(jobId, 'materials.json', materials);
      log('Materials synthesized from bible (skipped trend research)');
      wlog('collecting_skipped_bible', { topics: materials.topics.length });
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
        snowflake = await generateSnowflake(materials, { lang, genre, referenceCharacter, referenceEvent, bible, fidelity, mode, log });
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
      const totalChapters = chapters ? chapters.chapters.length : 0;
      baseOutline = await generateOutline(enrichedMaterials, { lang, style, genre, referenceCharacter, referenceEvent, bible, fidelity, totalChapters, mode });
      if (bible && fidelity === 'tight') {
        validateOutlineChapterCoverage(baseOutline, fidelity, totalChapters);
      }
      saveArtifact(jobId, 'outline.json', baseOutline);
    } else {
      log('Resuming — outline already generated');
    }

    let basePlan = loadArtifact(jobId, 'plan.json');
    if (!basePlan) {
      let planSucceeded = false;
      try {
        log('Generating base scene plan...');
        const aggregateChapterRange = chapters && chapters.chapters.length ? [1, chapters.chapters.length] : null;
        basePlan = await generatePlan(baseOutline, { lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, aggregateChapterRange, mode });
        planSucceeded = true;
      } catch (err) {
        log(`[planning failed] ${err.message} — continuing without plan for this attempt; will retry on next run`);
        basePlan = { clips: [], characters: [], items: [], locations: [], revelations: [] };
      }
      // Only persist successful plans — a saved skeleton would poison all retries
      // by short-circuiting the "plan already generated" branch below.
      if (planSucceeded) saveArtifact(jobId, 'plan.json', basePlan);
    } else {
      log('Resuming — plan already generated');
    }

    // ─── Step 3: Compute split point (front half = shared) ────────────────
    const sortedEpisodes = [...baseOutline.episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);
    const totalEpisodes = sortedEpisodes.length;
    const splitIdx = Math.ceil(totalEpisodes / 2);
    const tailCount = totalEpisodes - splitIdx;
    // Defensive guard: parseOutline already enforces >=2 episodes, but a resumed
    // job could load a stale outline.json predating that check. Fail loud rather
    // than silently producing 3 identical "variants" with empty tails.
    if (tailCount < 1) {
      throw new Error(`Outline has ${totalEpisodes} episode(s); variant pipeline requires tailCount >= 1 (got ${tailCount}). Delete outline.json to regenerate.`);
    }
    const frontEpisodes = sortedEpisodes.slice(0, splitIdx);
    log(`Split: ${splitIdx}/${totalEpisodes} episodes shared as front half; remaining ${tailCount} diverge per variant.`);

    // ─── Step 4: Shared front-half scene generation ────────────────────────
    // The front is generated by calling generateDrama with a truncated outline
    // (front episodes only). We capture the latest progress from onEpisode so
    // each variant can reuse the completed front episodes as a resume seed.
    const frontStorePath = getStoreDir(jobId);
    const frontStore = createStore(frontStorePath);
    frontStore.load();

    let frontProgress = loadArtifact(jobId, 'front.json');
    // If the run crashed mid-front, the final front.json was never written
    // but front.progress.json persists each episode. Re-seed from progress
    // rather than regenerating the entire front (30+ minutes of LLM time).
    const partialFront = !frontProgress ? loadArtifact(jobId, 'front.progress.json') : null;
    if (partialFront) {
      log(`Resuming front-half from partial progress (${partialFront.episodes?.length || 0}/${splitIdx} episodes done).`);
      wlog('front_resumed_partial', { completedEpisodes: partialFront.episodes?.length || 0, splitIdx });
    }
    if (!frontProgress) {
      log(`Generating front-half clips (episodes 0..${splitIdx - 1})...`);
      wlog('front_start', { splitIdx, totalEpisodes });
      const truncatedOutline = { ...baseOutline, episodes: frontEpisodes };
      let latestProgress = partialFront || null;
      const frontStory = await generateDrama(materials, {
        lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, style, mode, log, wlog,
        vectorStore: frontStore,
        savedSnowflake: snowflake,
        savedOutline: truncatedOutline,
        savedPlan: basePlan,
        progress: partialFront || undefined,
        onEpisode: (pd) => {
          latestProgress = pd;
          saveArtifact(jobId, 'front.progress.json', pd);
        },
        onState: (s) => saveArtifact(jobId, 'front.state.json', s),
      });
      frontProgress = latestProgress || {
        episodes: frontStory.episodes,
        episodeContexts: {},
        globalClipIndex: frontStory.episodes.reduce((s, ep) => s + (ep.scenes?.length || 0), 0),
      };
      saveArtifact(jobId, 'front.json', frontProgress);
      try {
        frontStore.save();
      } catch (err) {
        log(`[front vector store save failed] ${err.message} — variant retrieval may be degraded until next full run`);
        wlog('front_store_save_failed', { error: err.message });
      }
      const frontClipCount = frontProgress.episodes.reduce((s, ep) => s + (ep.scenes?.length || 0), 0);
      log(`Front half done: ${frontProgress.episodes.length} episodes, ${frontClipCount} clips`);
      wlog('front_done', { episodes: frontProgress.episodes.length, clips: frontClipCount });
    } else {
      log(`Resuming — front half already generated (${frontProgress.episodes.length} episodes)`);
    }

    // ─── Step 5: Per-variant tail generation + upload ──────────────────────
    updateJob(jobId, { status: 'uploading' });
    const variationGroupId = `grp-${jobId}`;
    const storyIds = [];
    let sampleStory = null;
    let totalClipsAcrossVariants = 0;
    let totalWordsAcrossVariants = 0;

    for (const v of VARIANTS) {
      const uploadedKey = `upload.${v.key}.json`;
      const prior = loadArtifact(jobId, uploadedKey);
      if (prior && prior.storyId) {
        log(`Variant ${v.key} (${v.label}) already uploaded: ${prior.storyId}`);
        storyIds.push(prior.storyId);
        // Populate sampleStory AND fold the cached variant's clip/word totals
        // into the summary counters — earlier the resume path silently dropped
        // them, so a job that completed via multiple runOnce calls reported
        // totals only for the variants generated in the final run.
        const cachedStory = loadArtifact(jobId, `story.${v.key}.json`);
        if (cachedStory) {
          if (!sampleStory) sampleStory = cachedStory;
          const vClips = (cachedStory.episodes || []).reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
          const vWords = (cachedStory.episodes || []).reduce(
            (sum, ep) => sum + (ep.scenes || []).reduce((s, sc) => s + countWords(sc.content), 0), 0);
          totalClipsAcrossVariants += vClips;
          totalWordsAcrossVariants += vWords;
        }
        continue;
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
      // Re-validate full-coverage chapter range for the assembled variant
      // outline under tight fidelity. The base outline passed validation
      // pre-split, but the tail LLM may have skipped chapters.
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
      // Re-save the in-memory front store right before the fork: an earlier save
      // may have failed (and only logged), in which case the on-disk file is
      // stale and copyFileSync would clone the stale snapshot into the variant
      // store with no warning.
      const variantStorePath = join(JOBS_DIR, jobId, `vectorstore.${v.key}.json`);
      if (!existsSync(variantStorePath)) {
        try {
          frontStore.save();
        } catch (err) {
          log(`[variant ${v.key}] front store re-save before fork failed: ${err.message} — fork may use a stale snapshot`);
          wlog('front_store_resave_failed', { variant: v.key, error: err.message });
        }
        if (existsSync(frontStorePath)) {
          try {
            copyFileSync(frontStorePath, variantStorePath);
          } catch (err) {
            log(`[variant ${v.key}] vector store fork failed: ${err.message} — variant will start with empty retrieval`);
            wlog('variant_store_fork_failed', { variant: v.key, error: err.message });
          }
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
      // generateDrama skips them and only generates the tail.
      // globalClipIndex is reset to 0; the skip loop re-accumulates it
      // as it passes through completed front episodes.
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
          lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, style, mode, log, wlog,
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
      const vClips = variantStory.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
      const vWords = variantStory.episodes.reduce(
        (sum, ep) => sum + ep.scenes.reduce((s, sc) => s + countWords(sc.content), 0), 0);
      totalClipsAcrossVariants += vClips;
      totalWordsAcrossVariants += vWords;
      log(`Variant ${v.key}: "${variantStory.title}" — ${variantStory.episodes.length} eps, ${vClips} clips, ${vWords} words`);

      // Upload — write a "pending" artifact with the idempotency key BEFORE
      // the HTTP call so a crash between request-success and artifact-save
      // doesn't produce a duplicate platform story on retry. The platform
      // is expected to honor the Idempotency-Key header / body field and
      // return the same storyId for repeated POSTs with the same key.
      const idempotencyKey = `${jobId}.${v.key}`;
      const pendingKey = `upload.${v.key}.pending.json`;
      // If a previous attempt already started an upload for this variant, the
      // pending artifact records the idempotency key and (after first response)
      // the storyId. On retry, the platform should return the same storyId
      // for the same key — log loudly if it changes (signals the platform
      // didn't honor idempotency, so we'd be creating duplicates).
      const priorPending = loadArtifact(jobId, pendingKey);
      saveArtifact(jobId, pendingKey, {
        idempotencyKey, variationGroupId, variationLabel: v.label, ending: v.ending,
        startedAt: priorPending?.startedAt || new Date().toISOString(),
        priorStoryId: priorPending?.storyId || null,
        attempts: (priorPending?.attempts || 0) + 1,
      });
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
      // Persist the storyId in the pending artifact so a future retry can
      // detect duplicates (above check) even after a crash before the final
      // saveArtifact below.
      saveArtifact(jobId, pendingKey, {
        idempotencyKey, variationGroupId, variationLabel: v.label, ending: v.ending,
        startedAt: priorPending?.startedAt || new Date().toISOString(),
        storyId: uploadResult.storyId,
        attempts: (priorPending?.attempts || 0) + 1,
      });
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

      storyIds.push(uploadResult.storyId);
    }

    // Record exactly one history entry per drama group (not per variant —
    // three variants with the same title would push the same topic three
    // times into the dedupe window). Use the first variant's storyId as a
    // group reference; downstream history consumers only care about topic
    // freshness and genre coverage.
    if (sampleStory && storyIds.length > 0) {
      addEntry({
        topic: sampleStory.title,
        genres: sampleStory.genres || [],
        variationGroupId,
        storyId: storyIds[0],
      });
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
    log(`Episodes per variant: ${epsPerVariant}, total clips across variants: ${totalClipsAcrossVariants}, total words across variants: ${totalWordsAcrossVariants}`);
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
      `=== Duanju Writer Work Log Summary ===`,
      `Job ID:          ${jobId}`,
      `Title:           ${sampleStory?.title || '(unknown)'}`,
      `Language:        ${lang}`,
      `Genre:           ${genre || '(any)'}`,
      `News:            ${newsUrl || '(none)'}`,
      `Ref character:   ${referenceCharacter ? `${referenceCharacter.length} chars` : '(none)'}`,
      `Ref event:       ${referenceEvent ? `${referenceEvent.length} chars` : '(none)'}`,
      `Trope:           ${style}`,
      `Episodes:        ${episodesPerDrama}`,
      `Clips/episode:   ${clipsPerEpisode}`,
      `Variation Group: ${variationGroupId}`,
      ``,
      `--- Variations ---`,
      ...VARIANTS.map((v, i) => `${v.label.padEnd(22)} ${storyIds[i] || '(not uploaded)'}`),
      ``,
      `Episodes per variant: ${epsPerVariant}`,
      `Split point:          ${splitIdx}/${totalEpisodes} (front shared)`,
      `Clips (total):        ${totalClipsAcrossVariants}`,
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
  // Atomically take the job before processing. If the daemon worker is
  // running and has already claimed this job, bail out — running both would
  // produce duplicate uploads and racing artifact writes.
  let claimed = claimJob(jobId);
  if (!claimed) {
    const existing = getJob(jobId);
    if (!existing) {
      console.log(chalk.red(`  [${jobId}] Job not found.`));
      return;
    }
    if (existing.status === 'done' || existing.status === 'failed') {
      console.log(chalk.yellow(`  [${jobId}] Job is already ${existing.status} — nothing to do.`));
      return;
    }
    // Status is collecting/writing/uploading: either a live worker holds it,
    // or a previous SIGKILL left it stuck. We can't tell the two apart from
    // job state alone, so we use the pidfile as a liveness signal — if no
    // worker pidfile exists, the job is orphaned and we recover it. If a
    // worker IS alive, leave the job alone to avoid double-processing.
    const { isWorkerAlive } = await import('./pidfile.js');
    if (isWorkerAlive()) {
      console.log(chalk.yellow(`  [${jobId}] Job is ${existing.status} and a worker daemon is running — skipping runOnce.`));
      return;
    }
    const recovered = unstickJob(jobId);
    if (!recovered) {
      console.log(chalk.yellow(`  [${jobId}] Job is ${existing.status} and could not be recovered — skipping.`));
      return;
    }
    console.log(chalk.dim(`  [${jobId}] Recovered orphaned job from status=${existing.status} (no live worker). Retrying.`));
    claimed = claimJob(jobId);
    if (!claimed) {
      console.log(chalk.red(`  [${jobId}] Could not claim recovered job (race) — skipping.`));
      return;
    }
  }

  let success = await processJob(jobId, options);
  let attempt = 0;
  while (!success) {
    const job = getJob(jobId);
    if (!job || job.status !== 'pending') break;
    // Re-claim after the previous attempt flipped the job back to pending
    // for retry. If another worker grabbed it in between, stop retrying
    // here — that worker now owns the job.
    const reclaimed = claimJob(jobId);
    if (!reclaimed) {
      console.log(chalk.yellow(`  [${jobId}] Another process claimed the job during retry — stepping back.`));
      break;
    }
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
  console.log(chalk.cyan(`Worker started — polling for jobs (lang=${config.lang || 'cn'}, type=${config.genre || 'any'}, style=${config.style || 'default'})...`));

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
          genre: opts.genre || undefined,
          newsUrl: opts.newsUrl || undefined,
          referenceCharacter: opts.referenceCharacter || undefined,
          referenceEvent: opts.referenceEvent || undefined,
          referenceStory: opts.referenceStory || undefined,
          fidelity: opts.fidelity || undefined,
          episodesPerDrama: opts.episodesPerDrama || undefined,
          clipsPerEpisode: opts.clipsPerEpisode || undefined,
          mode: opts.mode || undefined,
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
