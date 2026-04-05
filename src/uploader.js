import { loadConfig } from './config.js';

export function buildRequest(story, config) {
  const url = `${config.autostoryUrl}/api/ai/stories`;
  // Deep-copy episodes to avoid mutating the original story object
  const body = {
    ...story,
    episodes: story.episodes?.map(({ episodeChoices, ...ep }) => ({
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

// ─── Fetch & verify ─────────────────────────────────────────────────────────

export async function fetchStory(storyId) {
  const config = loadConfig();
  const url = `${config.autostoryUrl}/api/ai/stories/${storyId}`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': config.aiApiKey },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}): ${(await res.json().catch(() => ({}))).error || res.statusText}`);
  }
  return await res.json();
}

/**
 * Compare local story choices against what the server has stored.
 * Returns { ok, episodes[] } where each episode entry shows match/mismatch details.
 */
export function verifyChoices(localStory, remoteStory) {
  const results = [];
  let allOk = true;

  // Build remote lookup: scene UUID → { choices, episodeIndex }
  // Also build episode first-scene map: episodeIndex → first scene UUID
  const remoteEpByIndex = {};
  for (const ep of remoteStory.episodes) {
    remoteEpByIndex[ep.sortOrder] = ep;
  }

  // Build map: target episodeIndex → first scene id (for verifying nextSceneId)
  const firstSceneIdByEpIndex = {};
  for (const ep of remoteStory.episodes) {
    const firstScene = ep.scenes?.find(s => s.sortOrder === 0);
    if (firstScene) {
      firstSceneIdByEpIndex[ep.sortOrder] = firstScene.id;
    }
  }

  for (const localEp of localStory.episodes) {
    const epIndex = localEp.episodeIndex;
    const remoteEp = remoteEpByIndex[epIndex];

    if (!remoteEp) {
      results.push({ episodeIndex: epIndex, title: localEp.title, status: 'MISSING', detail: 'Episode not found on server' });
      allOk = false;
      continue;
    }

    // Get local choices: from episodeChoices on the episode, which were placed on the last scene
    const localChoices = localEp.episodeChoices || [];

    // Get remote choices: from the last scene of the remote episode
    const remoteLastScene = remoteEp.scenes?.reduce((a, b) => (b.sortOrder > a.sortOrder ? b : a), remoteEp.scenes[0]);
    const remoteChoices = remoteLastScene?.choices || [];

    if (localChoices.length === 0 && remoteChoices.length === 0) {
      results.push({ episodeIndex: epIndex, title: localEp.title, status: 'OK', detail: 'No choices (ending episode)', localCount: 0, remoteCount: 0 });
      continue;
    }

    if (localChoices.length !== remoteChoices.length) {
      results.push({
        episodeIndex: epIndex, title: localEp.title, status: 'MISMATCH',
        detail: `Choice count differs: local=${localChoices.length}, remote=${remoteChoices.length}`,
        localCount: localChoices.length, remoteCount: remoteChoices.length,
      });
      allOk = false;
      continue;
    }

    // Compare each choice text and target
    const mismatches = [];
    for (let i = 0; i < localChoices.length; i++) {
      const local = localChoices[i];
      const remote = remoteChoices.find(r => r.sortOrder === i) || remoteChoices[i];

      if (local.text !== remote.text) {
        mismatches.push({ index: i, field: 'text', local: local.text, remote: remote.text });
      }

      // Verify the remote nextSceneId points to the correct target episode's first scene
      const expectedTargetSceneId = firstSceneIdByEpIndex[local.nextEpisodeIndex];
      if (expectedTargetSceneId && remote.nextSceneId !== expectedTargetSceneId) {
        mismatches.push({
          index: i, field: 'target',
          local: `episode ${local.nextEpisodeIndex} → scene ${expectedTargetSceneId}`,
          remote: `scene ${remote.nextSceneId}`,
        });
      }
    }

    if (mismatches.length > 0) {
      results.push({
        episodeIndex: epIndex, title: localEp.title, status: 'MISMATCH',
        detail: `${mismatches.length} choice(s) differ`,
        localCount: localChoices.length, remoteCount: remoteChoices.length,
        mismatches,
      });
      allOk = false;
    } else {
      results.push({
        episodeIndex: epIndex, title: localEp.title, status: 'OK',
        detail: `All ${localChoices.length} choices match`,
        localCount: localChoices.length, remoteCount: remoteChoices.length,
      });
    }
  }

  return { ok: allOk, episodes: results };
}
