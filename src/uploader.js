import { loadConfig } from './config.js';

// Upper bound on a single upload attempt. Without this, a hung Duanju API
// (overloaded, deadlocked, network black hole) blocks the worker indefinitely
// because fetch() has no built-in timeout. Job-level retry won't help if the
// job never returns. Configurable via config.uploadTimeout.
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

export function buildRequest(drama, config, variationOptions = {}) {
  // Endpoint path preserved (`/api/ai/stories`) so the existing Duanju
  // ingestion route stays stable — the body discriminator `format: "duanju"`
  // tells the server to use the new short-drama schema.
  const url = `${config.autostoryUrl}/api/ai/stories`;
  const body = {
    format: 'duanju',
    title: drama.title,
    synopsis: drama.synopsis,
    trope: drama.trope || '',
    // Send both shapes: outline parser produces a singular `genre` (one of
    // 都市/复仇/甜宠/古装/家庭/玄幻); the snowflake/research stage may have
    // produced a `genres` array of finer-grained tags.
    genre: drama.genre || '',
    genres: drama.genres || [],
    tags: drama.tags || [],
    lang: drama.lang || 'cn',
    characters: drama.characters || [],
    episodes: (drama.episodes || []).map(ep => ({
      episodeIndex: ep.episodeIndex,
      title: ep.title,
      isEnding: !!ep.isEnding,
      ending: ep.ending || null,
      clips: (ep.clips || []).map(clip => ({ ...clip })),
    })),
  };

  if (variationOptions.variationGroupId) body.variationGroupId = variationOptions.variationGroupId;
  if (variationOptions.variationLabel) body.variationLabel = variationOptions.variationLabel;
  if (variationOptions.idempotencyKey) body.idempotencyKey = variationOptions.idempotencyKey;
  if (config.publishOnUpload !== undefined) body.publish = config.publishOnUpload;

  const timeoutMs = Number.isFinite(config.uploadTimeout) && config.uploadTimeout > 0
    ? config.uploadTimeout
    : DEFAULT_UPLOAD_TIMEOUT_MS;

  // Surface the idempotency key as a header too, so a platform that
  // dedupes at the request layer (rather than parsing the body) can also
  // honor it. Header takes precedence in most idempotency middleware.
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': config.aiApiKey,
  };
  if (variationOptions.idempotencyKey) {
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
