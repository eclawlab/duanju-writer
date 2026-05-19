import { loadConfig } from './config.js';

// Mirror of uploader.js: a hung Duanju API must not block the modify flow
// indefinitely (fetch has no built-in timeout). Reuses config.uploadTimeout
// so download/upload share one tunable knob for the same platform.
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

export function buildDownloadRequest(storyId, config) {
  if (!storyId) throw new Error('buildDownloadRequest: storyId is required');
  // REST counterpart of the uploader's POST /api/ai/stories.
  const url = `${config.autostoryUrl}/api/ai/stories/${encodeURIComponent(storyId)}`;

  const timeoutMs = Number.isFinite(config.uploadTimeout) && config.uploadTimeout > 0
    ? config.uploadTimeout
    : DEFAULT_DOWNLOAD_TIMEOUT_MS;

  const headers = { 'X-Api-Key': config.aiApiKey };

  return {
    url,
    options: {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    },
    timeoutMs,
  };
}

// Coerce the platform payload into the internal drama shape that
// uploader.buildRequest consumes. The platform may nest the story under
// `body.story` (matching the upload *response* envelope) or return it flat;
// episodes/characters may live on either level. We accept both rather than
// betting on one undocumented shape.
export function normalizeStory(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Download returned no usable story body');
  }
  const s = (body.story && typeof body.story === 'object') ? body.story : body;

  const episodesSrc = s.episodes || body.episodes || [];
  const charactersSrc = s.characters || body.characters || [];

  const episodes = (Array.isArray(episodesSrc) ? episodesSrc : []).map((ep, i) => {
    const scenesSrc = ep.scenes || ep.clips || [];
    const out = {
      title: ep.title || '',
      episodeIndex: Number.isFinite(ep.episodeIndex) ? ep.episodeIndex : i,
      scenes: (Array.isArray(scenesSrc) ? scenesSrc : []).map((sc) => {
        const scene = {
          content: sc.content || '',
          choices: Array.isArray(sc.choices) ? sc.choices : [],
          conclusion: sc.conclusion ?? null,
        };
        if (Number.isFinite(sc.durationSec)) scene.durationSec = sc.durationSec;
        if (sc.setting)  scene.setting  = sc.setting;
        if (sc.action)   scene.action   = sc.action;
        if (sc.dialogue) scene.dialogue = sc.dialogue;
        if (sc.hook)     scene.hook     = sc.hook;
        if (sc.sceneType) scene.sceneType = sc.sceneType;
        return scene;
      }),
    };
    if (ep.isEnding) out.isEnding = true;
    if (ep.ending)   out.ending   = ep.ending;
    return out;
  });

  // uploader.buildRequest PREPENDS singular `genre`→genres[] and
  // `trope`→tags[]. The platform echoes back the merged array AND
  // primaryGenre/trope. If we keep the merged array and also re-derive
  // genre/trope below, the next upload prepends again → unbounded
  // duplication every modify cycle. Strip the leading primary value here so
  // the round-trip is idempotent.
  const stripLeading = (arr, val) => {
    const a = Array.isArray(arr) ? [...arr] : [];
    if (val && a[0] === val) a.shift();
    return a;
  };

  const drama = {
    title: s.title || '',
    synopsis: s.synopsis || '',
    genres: stripLeading(s.genres, s.primaryGenre),
    tags: stripLeading(s.tags, s.trope),
    characters: (Array.isArray(charactersSrc) ? charactersSrc : [])
      .filter((c) => c && c.name)
      .map((c) => {
        const out = { name: c.name };
        if (c.role)        out.role        = c.role;
        if (c.description) out.description = c.description;
        if (c.arc != null) out.arc         = c.arc;
        return out;
      }),
    episodes,
  };
  if (s.lang)         drama.lang  = s.lang;
  // Upload merges singular `genre`/`trope` into genres[]/tags[]; on the way
  // back they only exist as primaryGenre/trope. Map them back so a
  // download→modify→upload round-trip preserves them.
  if (s.primaryGenre) drama.genre = s.primaryGenre;
  if (s.trope)        drama.trope = s.trope;
  if (s.fandom)       drama.fandom = s.fandom;
  return drama;
}

function extractErrorMessage(res) {
  return res.body?.error || res.bodyText?.slice(0, 300) || `HTTP ${res.status}`;
}

export function handleDownloadResponse(res) {
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${extractErrorMessage(res)}`);
  }
  if (!res.body) {
    const detail = res.bodyText?.slice(0, 300) || '(empty body)';
    throw new Error(`Download returned 2xx but no JSON body: ${detail}`);
  }
  const drama = normalizeStory(res.body);
  if (!drama.title && drama.episodes.length === 0) {
    throw new Error('Download returned a story with no title and no episodes');
  }
  return { success: true, drama, data: res.body };
}

async function readBody(res) {
  const text = await res.text().catch(() => '');
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch {}
  }
  return { body, bodyText: text };
}

export async function download(storyId) {
  const config = loadConfig();
  const { url, options, timeoutMs } = buildDownloadRequest(storyId, config);
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.code === 23) {
      throw new Error(`Download timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
  const { body, bodyText } = await readBody(res);
  return handleDownloadResponse({ ok: res.ok, status: res.status, body, bodyText });
}
