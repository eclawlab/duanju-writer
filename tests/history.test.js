import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '.test_history');
const HISTORY_PATH = join(TEST_DIR, 'history.json');

describe('history', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('getHistoryFrom returns empty array when no file', async () => {
    const { getHistoryFrom } = await import('../src/history.js');
    const history = getHistoryFrom(HISTORY_PATH);
    assert.deepEqual(history, []);
  });

  test('getHistoryFrom returns empty array for invalid JSON', async () => {
    const { getHistoryFrom } = await import('../src/history.js');
    writeFileSync(HISTORY_PATH, 'not json', 'utf8');
    const history = getHistoryFrom(HISTORY_PATH);
    assert.deepEqual(history, []);
  });

  test('addEntryTo appends entries with createdAt timestamp', async () => {
    const { addEntryTo, getHistoryFrom } = await import('../src/history.js');
    addEntryTo(HISTORY_PATH, { topic: 'space opera', genres: ['sci-fi'] });
    const history = getHistoryFrom(HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].topic, 'space opera');
    assert.deepEqual(history[0].genres, ['sci-fi']);
    assert.ok(history[0].createdAt); // timestamp added
    assert.ok(new Date(history[0].createdAt).getTime() > 0); // valid ISO date
  });

  test('addEntryTo appends multiple entries in order', async () => {
    const { addEntryTo, getHistoryFrom } = await import('../src/history.js');
    addEntryTo(HISTORY_PATH, { topic: 'space opera', genres: ['sci-fi'] });
    addEntryTo(HISTORY_PATH, { topic: 'vampire romance', genres: ['romance'] });
    addEntryTo(HISTORY_PATH, { topic: 'mystery island', genres: ['mystery'] });
    const history = getHistoryFrom(HISTORY_PATH);
    assert.equal(history.length, 3);
    assert.equal(history[0].topic, 'space opera');
    assert.equal(history[1].topic, 'vampire romance');
    assert.equal(history[2].topic, 'mystery island');
  });

  test('history caps at 50 entries keeping newest', async () => {
    const { addEntryTo, getHistoryFrom } = await import('../src/history.js');
    for (let i = 0; i < 55; i++) {
      addEntryTo(HISTORY_PATH, { topic: `topic_${i}`, genres: [] });
    }
    const history = getHistoryFrom(HISTORY_PATH);
    assert.equal(history.length, 50);
    assert.equal(history[0].topic, 'topic_5');
    assert.equal(history[49].topic, 'topic_54');
  });

  test('addEntryTo preserves existing entry fields', async () => {
    const { addEntryTo, getHistoryFrom } = await import('../src/history.js');
    addEntryTo(HISTORY_PATH, { topic: 'test', genres: ['a'], storyId: 'abc123' });
    const history = getHistoryFrom(HISTORY_PATH);
    assert.equal(history[0].storyId, 'abc123');
  });

  test('exactly 50 entries are not trimmed', async () => {
    const { addEntryTo, getHistoryFrom } = await import('../src/history.js');
    for (let i = 0; i < 50; i++) {
      addEntryTo(HISTORY_PATH, { topic: `topic_${i}`, genres: [] });
    }
    const history = getHistoryFrom(HISTORY_PATH);
    assert.equal(history.length, 50);
    assert.equal(history[0].topic, 'topic_0');
  });
});
