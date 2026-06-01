import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { HISTORY_FILE } from './constants.js';
import { withLock } from './lock.js';

const MAX_ENTRIES = 50;

function readHistory(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    // A valid-but-non-array file (e.g. {} or a corrupted-yet-parseable shape)
    // would slip past the JSON catch and then crash addEntryTo's entries.push.
    // Treat it as corrupt: preserve aside and degrade to []. (Mirror queue.js.)
    if (!Array.isArray(parsed)) throw new Error('history.json is not an array');
    return parsed;
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
