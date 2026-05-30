import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

// Shared JSON-artifact persistence with schemaVersion tagging + corruption
// handling. Path-based (caller owns path construction) so it works for both the
// worker's per-job artifacts and any other versioned JSON sidecar.

/**
 * Write `data` to `filePath` as pretty JSON. JSON objects (not arrays) are
 * tagged with `schemaVersion` so loadArtifact can reject stale data. Arrays and
 * primitives pass through untouched. The tag is written LAST (spread data
 * first) so re-saving a previously-loaded artifact refreshes the version rather
 * than preserving an old one.
 */
export function saveArtifact(filePath, data, schemaVersion) {
  const tagged = (data && typeof data === 'object' && !Array.isArray(data))
    ? { ...data, schemaVersion }
    : data;
  writeFileSync(filePath, JSON.stringify(tagged, null, 2) + '\n', 'utf8');
}

/**
 * Read + parse a JSON artifact. Returns null (and logs) when missing-as-far-as
 * caller-cares cases occur: file absent, corrupt JSON, or a schemaVersion that
 * doesn't match `schemaVersion`. A null return means "regenerate".
 *
 * @param {string} filePath
 * @param {number} schemaVersion - expected version (objects only)
 * @param {{ log?: (msg: string) => void, label?: string }} [opts]
 */
export function loadArtifact(filePath, schemaVersion, opts = {}) {
  const log = opts.log || (() => {});
  const label = opts.label || filePath;
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data) && data.schemaVersion !== schemaVersion) {
      log(`Artifact "${label}" has schemaVersion=${data.schemaVersion} (expected ${schemaVersion}) — will regenerate`);
      return null;
    }
    return data;
  } catch (err) {
    log(`Artifact "${label}" is corrupt (${err.message}) — will regenerate`);
    return null;
  }
}

/**
 * Delete an artifact if present. Returns true if a file was removed. Swallows
 * unlink errors (logged via opts.log) so a permission blip doesn't abort a
 * batch invalidation.
 */
export function removeArtifact(filePath, opts = {}) {
  const log = opts.log || (() => {});
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch (err) {
    log(`Failed to remove artifact "${opts.label || filePath}": ${err.message}`);
    return false;
  }
}
