import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JOBS_DIR } from './constants.js';

// Discover every novel this machine has published to usaduanju.com by scanning
// per-job upload artifacts. The worker writes upload.{v1,v2,v3}.json with the
// platform storyId after each successful variant upload — that file IS the
// local record of "what's live", so reading it back is the source of truth
// for `duanju-writer stories` (and answers "which storyId do I pass to
// `modify`?"). We deliberately ignore upload.*.pending.json: a pending file
// without a sibling final file means the upload never confirmed.
export function listPublishedStories(jobsDir = JOBS_DIR) {
  if (!existsSync(jobsDir)) return [];
  const rows = [];
  let jobDirs;
  try {
    jobDirs = readdirSync(jobsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  for (const jobId of jobDirs) {
    const dir = join(jobsDir, jobId);
    let files;
    try {
      files = readdirSync(dir).filter((f) => /^upload\.[^.]+\.json$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      let rec;
      try {
        rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      if (!rec || !rec.storyId) continue;
      let createdAt = null;
      try { createdAt = statSync(join(dir, f)).mtime.toISOString(); } catch {}
      rows.push({
        storyId: rec.storyId,
        title: rec.title || '(untitled)',
        variationLabel: rec.variationLabel || '',
        ending: rec.ending || '',
        variationGroupId: rec.variationGroupId || '',
        jobId,
        createdAt,
      });
    }
  }
  // Newest first. Job ids are job_YYYYMMDDHHMMSS_xxxx, so a lexical sort on
  // jobId orders by creation time; mtime is the tiebreaker within a job.
  rows.sort((a, b) => {
    if (a.jobId !== b.jobId) return a.jobId < b.jobId ? 1 : -1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  return rows;
}

// Optional substring filter over title / storyId / jobId (case-insensitive).
export function filterPublishedStories(rows, query) {
  if (!query || !query.trim()) return rows;
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.storyId.toLowerCase().includes(q) ||
      r.jobId.toLowerCase().includes(q),
  );
}
