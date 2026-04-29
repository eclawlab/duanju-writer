import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, statSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { HISTORY_FILE } from './constants.js';

const MAX_ENTRIES = 50;
const LOCK_STALE_MS = 30_000;
const LOCK_MAX_ATTEMPTS = 100;
const LOCK_SLEEP_MS = 20;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// Lock-then-mutate pattern (mirrors queue.js withLock). Unlocked concurrent
// writes can clobber each other or truncate the file mid-write on kill.
function withLock(filePath, fn) {
  const lockPath = filePath + '.lock';
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {}
      sleepSync(LOCK_SLEEP_MS);
      continue;
    }
    try { return fn(); }
    finally {
      try { closeSync(fd); } catch {}
      try { unlinkSync(lockPath); } catch {}
    }
  }
  throw new Error(`Could not acquire lock on ${filePath}`);
}

function readHistory(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return []; }
}

function writeHistoryAtomic(filePath, entries) {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(2).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

export function getHistoryFrom(filePath) {
  return readHistory(filePath);
}

export function addEntryTo(filePath, entry) {
  return withLock(filePath, () => {
    const entries = readHistory(filePath);
    entries.push({ ...entry, createdAt: new Date().toISOString() });
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
    writeHistoryAtomic(filePath, trimmed);
  });
}

export function getHistory() { return getHistoryFrom(HISTORY_FILE); }
export function addEntry(entry) { addEntryTo(HISTORY_FILE, entry); }
