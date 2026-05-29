import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM as defaultCallLLM } from './llm.js';
import { tryParseJson } from './json.js';
import { download as defaultDownload } from './downloader.js';
import { upload as defaultUpload } from './uploader.js';
import { DATA_DIR } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const META_TEMPLATE_PATH = join(__dirname, '..', 'prompts', 'modify-meta.md');
const EPISODE_TEMPLATE_PATH = join(__dirname, '..', 'prompts', 'modify-episode.md');

// JSON salvage (clean fences + loose parse) is shared via ./json.js.

// Fill `{{name}}` placeholders via function replacement so `$` sequences in
// story/feedback text are not interpreted as regex replacement patterns. Each
// placeholder appears once per template.
function fillTemplate(template, values) {
  let out = template;
  for (const [key, val] of Object.entries(values)) {
    out = out.replace(`{{${key}}}`, () => val);
  }
  return out;
}

// Pass 1 prompt — novel-level metadata only. Episode bodies are deliberately
// excluded so this prompt stays small and the model can't degrade into
// verbatim copying (the very failure that left most of the novel unmodified).
export function buildMetaPrompt(drama, feedback, lang = 'cn') {
  const meta = {
    title: drama.title,
    synopsis: drama.synopsis,
    genres: drama.genres,
    tags: drama.tags,
    characters: drama.characters,
  };
  return fillTemplate(readFileSync(META_TEMPLATE_PATH, 'utf8'), {
    lang: lang || 'cn',
    feedback: String(feedback || '').trim(),
    meta: JSON.stringify(meta, null, 2),
  });
}

// Pass 2 prompt — one episode at a time, with read-only global context. Run
// once per episode so the feedback is applied across the WHOLE novel.
export function buildEpisodePrompt(drama, episode, feedback, epnum, eptotal, lang = 'cn') {
  return fillTemplate(readFileSync(EPISODE_TEMPLATE_PATH, 'utf8'), {
    lang: lang || 'cn',
    feedback: String(feedback || '').trim(),
    title: String(drama.title || ''),
    synopsis: String(drama.synopsis || ''),
    characters: JSON.stringify(drama.characters || [], null, 2),
    epnum: String(epnum),
    eptotal: String(eptotal),
    episode: JSON.stringify(episode, null, 2),
  });
}

// Merge the metadata pass over the original. A dropped/invalid field falls
// back to the original so a partial response can't blank the novel. An
// explicit `characters: []` is an intentional "remove all characters"
// (audit #12) and is honored; an absent key falls back.
function mergeMeta(original, meta) {
  const out = { ...original };
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    if (typeof meta.title === 'string' && meta.title.trim()) out.title = meta.title;
    if (typeof meta.synopsis === 'string' && meta.synopsis.trim()) out.synopsis = meta.synopsis;
    if (Array.isArray(meta.genres)) out.genres = meta.genres;
    if (Array.isArray(meta.tags)) out.tags = meta.tags;
    if (Array.isArray(meta.characters)) out.characters = meta.characters;
  }
  if (!out.title) out.title = original.title;
  if (!Array.isArray(out.characters)) out.characters = original.characters || [];
  return out;
}

// Merge a single revised episode over the original. The model must never
// renumber episodes, and a flaky response (unparseable, wrong shape, or no
// usable scene content) falls back to the original episode body so one bad
// call can't blank part of the novel.
function mergeEpisode(original, revised) {
  if (!revised || typeof revised !== 'object' || Array.isArray(revised)) return original;
  const out = { ...original, ...revised };
  out.episodeIndex = original.episodeIndex;
  const scenesOk = Array.isArray(out.scenes)
    && out.scenes.some((s) => s && typeof s.content === 'string' && s.content.trim());
  if (!scenesOk) out.scenes = original.scenes;
  return out;
}

export async function applyFeedback(drama, feedback, opts = {}) {
  if (!feedback || !String(feedback).trim()) {
    throw new Error('applyFeedback: feedback is required');
  }
  const llmFn = opts.llmFn || defaultCallLLM;
  const lang = opts.lang || drama.lang || 'cn';
  const role = opts.role || 'clip';
  const log = opts.log || (() => {});

  // Pass 1 — novel-level metadata. Unparseable → keep original metadata
  // (resilient: never destroy a whole novel because the model added a
  // preamble), the per-episode pass still runs.
  const metaRaw = await llmFn(buildMetaPrompt(drama, feedback, lang), role);
  const revised = mergeMeta(drama, tryParseJson(metaRaw));

  // Pass 2 — every episode gets its OWN LLM call, so the feedback reaches the
  // entire novel instead of only the first episodes the model bothered to
  // edit before reverting to verbatim copying.
  const episodes = Array.isArray(drama.episodes) ? drama.episodes : [];
  const total = episodes.length;
  const revisedEpisodes = [];
  for (let i = 0; i < total; i++) {
    log(`Revising episode ${i + 1}/${total}...`);
    const ep = episodes[i];
    const epRaw = await llmFn(
      buildEpisodePrompt(revised, ep, feedback, i + 1, total, lang),
      role,
    );
    revisedEpisodes.push(mergeEpisode(ep, tryParseJson(epRaw)));
  }
  revised.episodes = revisedEpisodes;

  const hasScene = revised.episodes.some(
    (ep) => Array.isArray(ep.scenes) && ep.scenes.some((s) => s && s.content),
  );
  if (!hasScene) {
    throw new Error('applyFeedback: revised story has no usable scene content');
  }
  return revised;
}

/**
 * Download an existing usaduanju.com novel, apply small feedback-driven
 * edits, and re-upload it as a NEW standalone novel.
 *
 * Deps are injectable for tests: downloadFn, uploadFn, llmFn.
 * @returns {Promise<{originalStoryId, newStoryId, drama, artifactDir}>}
 */
export async function modifyStory(params = {}) {
  const {
    storyId,
    feedback,
    lang,
    title,
    dryRun = false,
    downloadFn = defaultDownload,
    uploadFn = defaultUpload,
    llmFn,
    dataDir = DATA_DIR,
    log = () => {},
  } = params;

  if (!storyId) throw new Error('modifyStory: storyId is required');
  if (!feedback || !String(feedback).trim()) {
    throw new Error('modifyStory: feedback is required');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(dataDir, 'modifications', `${storyId}-${stamp}`);
  mkdirSync(artifactDir, { recursive: true });
  const save = (name, data) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
    writeFileSync(join(artifactDir, name), body, 'utf8');
  };

  log(`Downloading story ${storyId}...`);
  const { drama: original } = await downloadFn(storyId);
  save('original.json', original);
  save('feedback.txt', String(feedback));
  log(`Downloaded "${original.title}" — ${original.episodes.length} episode(s). Applying feedback...`);

  const modified = await applyFeedback(original, feedback, { llmFn, lang, log });
  if (title && title.trim()) modified.title = title.trim();
  save('modified.json', modified);

  if (dryRun) {
    log(`Dry run — skipping upload. Artifacts in ${artifactDir}`);
    save('result.json', { originalStoryId: storyId, newStoryId: null, dryRun: true });
    return { originalStoryId: storyId, newStoryId: null, drama: modified, artifactDir };
  }

  log(`Uploading modified story as a new novel: "${modified.title}"...`);
  // No variationOptions → no variationGroupId → the platform creates a
  // brand-new standalone novel rather than a variant of the original.
  const uploadResult = await uploadFn(modified);
  const newStoryId = uploadResult.storyId;
  save('result.json', { originalStoryId: storyId, newStoryId, title: modified.title });
  log(`Uploaded. New story ID: ${newStoryId}`);

  return { originalStoryId: storyId, newStoryId, drama: modified, artifactDir };
}
