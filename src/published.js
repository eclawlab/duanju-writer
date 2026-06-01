import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JOBS_DIR, DATA_DIR } from './constants.js';

const MODIFICATIONS_DIR = join(DATA_DIR, 'modifications');

// Discover every novel this machine has published to usaduanju.com by scanning
// per-job upload artifacts. The worker writes upload.{v1,v2,v3}.json with the
// platform storyId after each successful variant upload — that file IS the
// local record of "what's live", so reading it back is the source of truth
// for `duanju-writer stories` (and answers "which storyId do I pass to
// `modify`?"). We deliberately ignore upload.*.pending.json: a pending file
// without a sibling final file means the upload never confirmed.
export function listPublishedStories(jobsDir = JOBS_DIR, modificationsDir = MODIFICATIONS_DIR) {
  const rows = [];
  collectJobUploads(jobsDir, rows);
  collectModifications(modificationsDir, rows);
  // Newest first by createdAt (artifact mtime). jobId is only a tie-breaker —
  // sorting by jobId first was wrong because "job_..." < "mod:..." always
  // buried every modification above every job upload regardless of date.
  rows.sort((a, b) => {
    const byDate = (b.createdAt || '').localeCompare(a.createdAt || '');
    if (byDate !== 0) return byDate;
    return a.jobId < b.jobId ? 1 : a.jobId > b.jobId ? -1 : 0;
  });
  return rows;
}

function collectJobUploads(jobsDir, rows) {
  if (!existsSync(jobsDir)) return;
  let jobDirs;
  try {
    jobDirs = readdirSync(jobsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
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
}

// modify writes DATA_DIR/modifications/<storyId>-<stamp>/result.json with the
// new platform storyId. Without scanning this, `duanju-writer stories` could
// never surface a modified novel's id (defeating the modify→modify workflow).
function collectModifications(modificationsDir, rows) {
  if (!modificationsDir || !existsSync(modificationsDir)) return;
  let subdirs;
  try {
    subdirs = readdirSync(modificationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const sub of subdirs) {
    const rf = join(modificationsDir, sub, 'result.json');
    if (!existsSync(rf)) continue;
    let rec;
    try {
      rec = JSON.parse(readFileSync(rf, 'utf8'));
    } catch {
      continue;
    }
    if (!rec || !rec.newStoryId) continue; // dry-run / unpublished → skip
    let createdAt = null;
    try { createdAt = statSync(rf).mtime.toISOString(); } catch {}
    rows.push({
      storyId: rec.newStoryId,
      title: rec.title || '(untitled)',
      variationLabel: 'modified',
      ending: '',
      variationGroupId: '',
      jobId: `mod:${sub}`,
      createdAt,
    });
  }
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
