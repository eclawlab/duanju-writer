/**
 * Hook-density consistency check. Every non-conclusion scene in an episode
 * must end on a hook. Reads structured beats directly from the scene; falls
 * back to the legacy `_beats` ride-along for artifacts produced by pre-flatten
 * pipeline runs.
 *
 * (parseClip already throws on missing hooks; this check exists as
 * belt-and-suspenders for fallback-injected scenes that bypass parseClip.)
 */
export function checkHookDensity(episode) {
  const issues = [];
  for (const scene of episode.scenes || []) {
    const beats = scene._beats || scene;
    if (beats.isConclusion) continue;
    if (!beats.hook || beats.hook.trim().length === 0) {
      issues.push(`clip ${beats.clipIndex} of episode ${episode.episodeIndex} missing hook`);
    }
  }
  return issues;
}
