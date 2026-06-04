// Single source of truth for the scalar job-option keys carried from CLI/config
// onto a job record and back into processJob. Used by the daemon poll (from a
// job's persisted options) and the scheduler (from config) so the two
// "X || undefined" pass-through lists don't drift.
//
// Reference fields (referenceCharacter/Event/Story) are NOT included: the poll
// passes them through as-is while the scheduler resolves file paths to content,
// so callers handle those explicitly.
export const JOB_OPTION_KEYS = [
  'lang', 'style', 'genre', 'newsUrl', 'fidelity',
  'episodesPerDrama', 'clipsPerEpisode', 'mode', 'authorStyle',
];

/**
 * Copy the known scalar job-option keys from `src`, mapping falsy → undefined so
 * downstream (processJob) applies its own defaults. `publish` is a boolean, so
 * it's preserved explicitly — `false` must survive (||-undefined would flip it).
 * @param {object} src - a config object or a job's persisted options
 * @returns {object}
 */
export function pickJobOptions(src = {}) {
  const out = {};
  for (const k of JOB_OPTION_KEYS) out[k] = src[k] || undefined;
  out.publish = src.publish === false ? false : undefined;
  // Boolean like publish: only the non-default `false` must survive (||-undefined
  // would flip it). Default true is applied downstream by processJob.
  out.richContext = src.richContext === false ? false : undefined;
  return out;
}
