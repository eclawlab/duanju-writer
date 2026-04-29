import { loadConfig } from './config.js';

// Upper bound on a single upload attempt. Without this, a hung Duanju API
// (overloaded, deadlocked, network black hole) blocks the worker indefinitely
// because fetch() has no built-in timeout. Job-level retry won't help if the
// job never returns. Configurable via config.uploadTimeout.
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

export function buildRequest(drama, config, variationOptions = {}) {
  const url = `${config.autostoryUrl}/api/ai/stories`;

  // Merge writer-only fields into the server's existing string-array columns:
  //   - `genre` (singular) prepends to `genres[]`
  //   - `trope` prepends to `tags[]`
  // .filter(Boolean) drops empty/missing values without throwing.
  const genres = [drama.genre, ...(drama.genres || [])].filter(Boolean);
  const tags   = [drama.trope, ...(drama.tags   || [])].filter(Boolean);

  const body = {
    title: drama.title,
    synopsis: drama.synopsis,
    genres,
    tags,
    episodes: (drama.episodes || []).map(ep => ({
      title: ep.title,
      episodeIndex: ep.episodeIndex,
      scenes: ep.scenes || [],
    })),
  };

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
