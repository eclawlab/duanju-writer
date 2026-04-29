/**
 * Hook-density consistency check. Every non-conclusion scene in an episode
 * must end on a hook (recorded on the scene's non-enumerable _beats ride-along).
 * Returns an array of issue strings (empty when the episode is hook-clean).
 *
 * (parseClip already throws on missing hooks; this check exists as
 * belt-and-suspenders for fallback-injected scenes that bypass parseClip.)
 */
export function checkHookDensity(episode) {
  const issues = [];
  for (const scene of episode.scenes || []) {
    const beats = scene._beats || {};
    if (beats.isConclusion) continue;
    if (!beats.hook || beats.hook.trim().length === 0) {
      issues.push(`clip ${beats.clipIndex} of episode ${episode.episodeIndex} missing hook`);
    }
  }
  return issues;
}
