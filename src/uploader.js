import { loadConfig } from './config.js';

export function buildRequest(story, config) {
  const url = `${config.autostoryUrl}/api/ai/stories`;
  // Deep-copy episodes to avoid mutating the original story object
  const body = {
    ...story,
    episodes: story.episodes?.map(ep => ({
      ...ep,
      scenes: ep.scenes?.map(scene => ({ ...scene })),
    })),
  };
  if (config.publishOnUpload !== undefined) {
    body.publish = config.publishOnUpload;
  }

  // Transform episodeChoices on last scenes into choices with nextEpisodeIndex
  // so the server can resolve cross-episode scene references
  if (body.episodes) {
    for (const ep of body.episodes) {
      if (ep.scenes) {
        for (const scene of ep.scenes) {
          if (scene.episodeChoices && scene.episodeChoices.length > 0) {
            // Convert episode-level choices to scene choices with nextEpisodeIndex
            scene.choices = scene.episodeChoices.map(c => ({
              text: c.text,
              nextEpisodeIndex: c.nextEpisodeIndex,
              nextSceneIndex: 0, // always point to first scene of target episode
            }));
            delete scene.episodeChoices;
          }
        }
      }
    }
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
