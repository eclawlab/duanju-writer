import { loadConfig } from './config.js';

export function buildRequest(story, config) {
  const url = `${config.autostoryUrl}/api/ai/stories`;
  const body = { ...story };
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

export function handleResponse(res) {
  if (!res.ok) {
    const errMsg = res.body?.error || `HTTP ${res.status}`;
    throw new Error(`Upload failed (${res.status}): ${errMsg}`);
  }
  return {
    success: true,
    storyId: res.body?.story?.id || null,
    data: res.body,
  };
}

export async function upload(story) {
  const config = loadConfig();
  const { url, options } = buildRequest(story, config);
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  return handleResponse({ ok: res.ok, status: res.status, body });
}
