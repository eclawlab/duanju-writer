/**
 * Hook-density consistency check. Every non-conclusion clip must end on a hook.
 * Returns an array of issue strings (empty when the episode is hook-clean).
 *
 * (Note: prior consistency-rewrite / motif-tracker / overused-phrase checks
 * were removed when the pivot's structured clip schema replaced the flat
 * scene.content shape — those checks counted repetition in long prose and
 * produced no useful signal on 60-char dialogue lines. parseClip already
 * throws on missing hooks; this check exists as belt-and-suspenders for
 * fallback-injected clips that bypass parseClip.)
 */
export function checkHookDensity(episode) {
  const issues = [];
  for (const clip of episode.clips || []) {
    if (clip.isConclusion) continue;
    if (!clip.hook || clip.hook.trim().length === 0) {
      issues.push(`clip ${clip.clipIndex} of episode ${episode.episodeIndex} missing hook`);
    }
  }
  return issues;
}
