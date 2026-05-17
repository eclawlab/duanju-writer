import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM as defaultCallLLM } from './llm.js';
import { download as defaultDownload } from './downloader.js';
import { upload as defaultUpload } from './uploader.js';
import { DATA_DIR } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', 'prompts', 'modify.md');

// Self-contained JSON salvage helpers (story-bible.js keeps its own copies for
// the same reason — these are tiny and the modify flow shouldn't depend on
// bible-extraction internals).
function cleanJson(raw) {
  let s = String(raw).trim();
  if (s.startsWith('```')) s = s.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  return s;
}

function parseJsonLoose(cleaned) {
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}

export function buildModifyPrompt(drama, feedback, lang = 'cn') {
  let template = readFileSync(TEMPLATE_PATH, 'utf8');
  // String replace via a function so `$` sequences in story/feedback text
  // are not interpreted as regex replacement patterns.
  template = template.replace('{{lang}}', () => lang || 'cn');
  template = template.replace('{{feedback}}', () => String(feedback || '').trim());
  template = template.replace('{{drama}}', () => JSON.stringify(drama, null, 2));
  return template;
}

// Merge the model's revised drama over the original. Any top-level field the
// model drops falls back to the original so a partial response can't silently
// destroy the novel (e.g. an empty episodes array would otherwise upload a
// blank story). Episodes/characters are taken wholesale from the model only
// when present and non-empty.
function mergeRevision(original, revised) {
  if (!revised || typeof revised !== 'object') return original;
  const out = { ...original, ...revised };
  // Only fall back when the model OMITTED the field. An explicit empty array
  // is an intentional deletion ("remove all characters") and must be honored;
  // conflating it with "absent" silently ignored such feedback. A non-array
  // value is malformed → fall back. The post-merge hasScene guard in
  // applyFeedback still rejects a story left with no usable scene content.
  if (!('episodes' in revised) || !Array.isArray(revised.episodes)) {
    out.episodes = original.episodes;
  }
  if (!('characters' in revised) || !Array.isArray(revised.characters)) {
    out.characters = original.characters || [];
  }
  if (!out.title) out.title = original.title;
  return out;
}

export async function applyFeedback(drama, feedback, opts = {}) {
  if (!feedback || !String(feedback).trim()) {
    throw new Error('applyFeedback: feedback is required');
  }
  const llmFn = opts.llmFn || defaultCallLLM;
  const lang = opts.lang || drama.lang || 'cn';
  const role = opts.role || 'clip';
  const prompt = buildModifyPrompt(drama, feedback, lang);
  const raw = await llmFn(prompt, role);
  const parsed = parseJsonLoose(cleanJson(raw));
  if (!parsed) {
    throw new Error('applyFeedback: model response was not parseable JSON');
  }
  const merged = mergeRevision(drama, parsed);
  const hasScene = (merged.episodes || []).some(
    (ep) => Array.isArray(ep.scenes) && ep.scenes.some((s) => s && s.content),
  );
  if (!hasScene) {
    throw new Error('applyFeedback: revised story has no usable scene content');
  }
  return merged;
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

  const modified = await applyFeedback(original, feedback, { llmFn, lang });
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
