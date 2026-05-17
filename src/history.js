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
          // Atomic stale takeover (see queue.js for rationale): rename wins
          // for exactly one racer; never unlink a lock you didn't claim.
          try {
            const claim = `${lockPath}.stale.${process.pid}.${Date.now()}`;
            renameSync(lockPath, claim);
            unlinkSync(claim);
          } catch {}
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
  } catch {
    // Corrupt history. Returning [] alone is data loss: the next addEntry
    // would overwrite the file, destroying up to 50 dedupe records. Preserve
    // the bytes aside (mirrors queue.js's corrupt-file handling), then
    // degrade gracefully — history only feeds topic-freshness dedupe, so the
    // daemon should keep running rather than throw.
    try {
      const aside = `${filePath}.corrupt-${Date.now()}`;
      renameSync(filePath, aside);
      console.warn(`Warning: corrupt ${filePath} preserved as ${aside}; resetting history.`);
    } catch {}
    return [];
  }
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
