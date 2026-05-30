import { loadConfig } from './config.js';

// Upper bound on a single upload attempt. Without this, a hung Duanju API
// (overloaded, deadlocked, network black hole) blocks the worker indefinitely
// because fetch() has no built-in timeout. Job-level retry won't help if the
// job never returns. Configurable via config.uploadTimeout.
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

// Preflight probe budget — short, since it runs before any generation work.
const AUTH_PREFLIGHT_TIMEOUT_MS = 15_000;

/**
 * Verify the upload API will accept our credentials BEFORE the (expensive)
 * novel generation runs, so a missing/invalid key fails in seconds instead of
 * after ~30 minutes of LLM time ("Upload failed (401): Missing API key").
 *
 * Returns { ok: boolean, error?: string, warning?: string }:
 *  - No aiApiKey configured        -> ok:false (the reported "Missing API key" case).
 *  - Server returns 401/403        -> ok:false (key present but rejected).
 *  - Network/other error reaching  -> ok:true + warning (inconclusive; don't
 *    the server                       block on a transient blip — the real
 *                                     upload later has its own error handling).
 *  - Any other status (404/200/…)  -> ok:true (key accepted; a missing sentinel
 *                                     story just 404s).
 *
 * @param {object} [options]
 * @param {number} [options.timeout]
 * @param {function} [options.fetchFn] - injectable for tests
 * @param {object} [options.config] - injectable for tests (defaults to loadConfig())
 */
export async function verifyUploadAuth(options = {}) {
  const config = options.config || loadConfig();
  const baseUrl = config.autostoryUrl;
  const apiKey = config.aiApiKey;

  if (!apiKey || !String(apiKey).trim()) {
    return {
      ok: false,
      error: `No upload API key configured (config.aiApiKey is empty). `
        + `Run 'duanju-writer setup', or generate a key via POST ${baseUrl}/api/ai/keys `
        + `and set it with 'duanju-writer config set aiApiKey <key>'.`,
    };
  }

  const timeout = options.timeout || AUTH_PREFLIGHT_TIMEOUT_MS;
  const fetchFn = options.fetchFn || fetch;
  // Probe an authenticated GET against a sentinel story id. This distinguishes
  // auth failure (401/403) from a missing story (404) — any non-auth status
  // means the X-Api-Key header was accepted.
  const url = `${baseUrl}/api/ai/stories/__auth_preflight__`;
  let res;
  try {
    res = await fetchFn(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    return { ok: true, warning: `Upload auth preflight could not reach ${baseUrl}: ${err.message}` };
  }

  if (res.status === 401 || res.status === 403) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch {}
    return {
      ok: false,
      error: `Upload API rejected the configured key (HTTP ${res.status})${detail ? `: ${detail}` : ''}. `
        + `Check config.aiApiKey or regenerate it via POST ${baseUrl}/api/ai/keys.`,
    };
  }

  return { ok: true };
}

// Whitelisted scene fields sent to the server. Drops writer-internal flags
// (clipIndex, isConclusion) the server doesn't need (sort_order and the
// conclusion table cover those).
function pickSceneFields(scene) {
  const out = {
    content: scene.content,
    choices: scene.choices || [],
    conclusion: scene.conclusion || null,
  };
  if (Number.isFinite(scene.durationSec)) out.durationSec = scene.durationSec;
  if (scene.setting)  out.setting  = scene.setting;
  if (scene.action)   out.action   = scene.action;
  if (scene.dialogue) out.dialogue = scene.dialogue;
  if (scene.hook)     out.hook     = scene.hook;
  if (scene.sceneType) out.sceneType = scene.sceneType;
  return out;
}

function pickCharacterFields(c) {
  if (!c?.name) return null;
  const out = { name: c.name };
  if (c.role)        out.role        = c.role;
  if (c.description) out.description = c.description;
  if (c.arc != null) out.arc         = c.arc;
  return out;
}

export function buildRequest(drama, config, variationOptions = {}) {
  const url = `${config.autostoryUrl}/api/ai/stories`;

  // Merge writer-only fields into the server's existing string-array columns:
  //   - `genre` (singular) prepends to `genres[]`
  //   - `trope` prepends to `tags[]`
  // .filter(Boolean) drops empty/missing values without throwing.
  const genres = [drama.genre, ...(drama.genres || [])].filter(Boolean);
  const tags   = [drama.trope, ...(drama.tags   || [])].filter(Boolean);
  const characters = (drama.characters || []).map(pickCharacterFields).filter(Boolean);

  const body = {
    title: drama.title,
    synopsis: drama.synopsis,
    genres,
    tags,
    episodes: (drama.episodes || []).map(ep => {
      const epOut = {
        title: ep.title,
        episodeIndex: ep.episodeIndex,
        scenes: (ep.scenes || []).map(pickSceneFields),
      };
      // isEnding/ending are dedicated columns on the server's episodes table,
      // distinct from the per-scene conclusion record (the latter encodes the
      // ending enum, the former is a raw CN label kept for analytics).
      if (ep.isEnding) epOut.isEnding = true;
      if (ep.ending)   epOut.ending   = ep.ending;
      return epOut;
    }),
  };

  if (drama.lang)             body.lang         = drama.lang;
  if (drama.trope)            body.trope        = drama.trope;
  if (drama.genre)            body.primaryGenre = drama.genre;
  if (drama.fandom)           body.fandom       = drama.fandom;
  if (characters.length)      body.characters   = characters;

  if (variationOptions.variationGroupId) body.variationGroupId = variationOptions.variationGroupId;
  if (variationOptions.variationLabel)   body.variationLabel   = variationOptions.variationLabel;
  if (config.publishOnUpload !== undefined) body.publish = config.publishOnUpload;

  const timeoutMs = Number.isFinite(config.uploadTimeout) && config.uploadTimeout > 0
    ? config.uploadTimeout
    : DEFAULT_UPLOAD_TIMEOUT_MS;

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': config.aiApiKey,
  };
  if (variationOptions.idempotencyKey) {
    // Standard idempotency mechanism. Server doesn't dedup today, but the header
    // is the agreed surface — body-level idempotencyKey was non-standard noise.
    headers['Idempotency-Key'] = variationOptions.idempotencyKey;
  }

  return {
    url,
    options: {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
    timeoutMs,
  };
}

function extractErrorMessage(res) {
  return res.body?.error || res.bodyText?.slice(0, 300) || `HTTP ${res.status}`;
}

export function handleResponse(res) {
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}): ${extractErrorMessage(res)}`);
  }
  const storyId = res.body?.story?.id;
  if (!storyId) {
    const detail = res.bodyText?.slice(0, 300) || '(empty body)';
    throw new Error(`Upload returned 2xx but no story.id in response: ${detail}`);
  }
  return {
    success: true,
    storyId,
    data: res.body,
  };
}

async function readBody(res) {
  const text = await res.text().catch(() => '');
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch {}
  }
  return { body, bodyText: text };
}

export async function upload(story, variationOptions = {}) {
  const config = loadConfig();
  const { url, options, timeoutMs } = buildRequest(story, config, variationOptions);
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // AbortSignal.timeout produces a TimeoutError (DOMException). Surface this
    // distinctly so the worker's job-level retry can react to it cleanly.
    if (err?.name === 'TimeoutError' || err?.code === 23) {
      throw new Error(`Upload timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
  const { body, bodyText } = await readBody(res);
  return handleResponse({ ok: res.ok, status: res.status, body, bodyText });
}
