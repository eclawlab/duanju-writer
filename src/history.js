import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { HISTORY_FILE } from './constants.js';

const MAX_ENTRIES = 50;

function readHistory(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return []; }
}

function writeHistory(filePath, entries) {
  writeFileSync(filePath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

export function getHistoryFrom(filePath) {
  return readHistory(filePath);
}

export function addEntryTo(filePath, entry) {
  const entries = readHistory(filePath);
  entries.push({ ...entry, createdAt: new Date().toISOString() });
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
  writeHistory(filePath, trimmed);
}

export function getHistory() { return getHistoryFrom(HISTORY_FILE); }
export function addEntry(entry) { addEntryTo(HISTORY_FILE, entry); }
