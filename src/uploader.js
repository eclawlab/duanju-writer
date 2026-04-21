import { loadConfig } from './config.js';

export function buildRequest(story, config, variationOptions = {}) {
  const url = `${config.autostoryUrl}/api/ai/stories`;
  // Deep-copy episodes to avoid mutating the original story object
  const body = {
    ...story,
    episodes: story.episodes?.map(({ episodeChoices, ...ep }) => ({
      ...ep,
      scenes: ep.scenes?.map(scene => ({ ...scene })),
    })),
  };
  // Add variation metadata if provided
  if (variationOptions.variationGroupId) {
    body.variationGroupId = variationOptions.variationGroupId;
  }
  if (variationOptions.variationLabel) {
    body.variationLabel = variationOptions.variationLabel;
  }
  if (config.publishOnUpload !== undefined) {
    body.publish = config.publishOnUpload;
  }

  return {
    url,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.aiApiKey,
      },
      body: JSON.stringify(body),
    },
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
  const { url, options } = buildRequest(story, config, variationOptions);
  const res = await fetch(url, options);
  const { body, bodyText } = await readBody(res);
  return handleResponse({ ok: res.ok, status: res.status, body, bodyText });
}
