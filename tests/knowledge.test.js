import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '.test_knowledge');

describe('knowledge', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ── chunkText ────────────────────────────────────────────────────────────

  test('chunkText splits on paragraph boundaries', async () => {
    const { chunkText } = await import('../src/knowledge.js');
    const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';
    const chunks = chunkText(text, 500);
    assert.equal(chunks.length, 3);
    assert.ok(chunks[0].includes('First paragraph'));
    assert.ok(chunks[1].includes('Second paragraph'));
    assert.ok(chunks[2].includes('Third paragraph'));
  });

  test('chunkText splits long paragraphs on sentences', async () => {
    const { chunkText } = await import('../src/knowledge.js');
    // One paragraph with many sentences that together exceed maxChunkSize=50
    const text =
      'The quick brown fox jumps. The lazy dog sleeps. A cat runs fast. Birds fly high.';
    const chunks = chunkText(text, 50);
    // Each chunk must be <= ~50 chars (approximately)
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 80, `chunk too long: "${chunk}"`);
    }
    // All text must be represented
    const rejoined = chunks.join(' ');
    assert.ok(rejoined.includes('quick brown fox'));
    assert.ok(rejoined.includes('lazy dog'));
    assert.ok(rejoined.includes('cat runs'));
    assert.ok(rejoined.includes('Birds fly'));
  });

  test('chunkText respects maxChunkSize approximately', async () => {
    const { chunkText } = await import('../src/knowledge.js');
    // Build a paragraph with short sentences so we can test accumulation
    const sentences = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} here.`);
    const text = sentences.join(' ');
    const maxChunkSize = 60;
    const chunks = chunkText(text, maxChunkSize);
    // No chunk should be drastically larger than maxChunkSize (allow one sentence overage)
    for (const chunk of chunks) {
      assert.ok(
        chunk.length <= maxChunkSize + 40,
        `chunk too large: ${chunk.length} chars: "${chunk}"`
      );
    }
    assert.ok(chunks.length > 1, 'should produce multiple chunks');
  });

  test('chunkText handles text with no paragraph breaks', async () => {
    const { chunkText } = await import('../src/knowledge.js');
    const text = 'One sentence. Two sentence. Three sentence. Four sentence. Five sentence.';
    const chunks = chunkText(text, 500);
    // With a large maxChunkSize the whole text should be one chunk
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].includes('One sentence'));
    assert.ok(chunks[0].includes('Five sentence'));
  });

  // ── importDocument ───────────────────────────────────────────────────────

  test('importDocument chunks and adds to store', async () => {
    const { importDocument } = await import('../src/knowledge.js');
    const { createStore } = await import('../src/vectorstore.js');

    const filePath = join(TEST_DIR, 'worldbuilding.txt');
    writeFileSync(
      filePath,
      'The world is vast and ancient.\n\nMagic flows through every living thing.\n\nDragons rule the skies.',
      'utf8'
    );

    const storePath = join(TEST_DIR, 'store.json');
    const store = createStore(storePath);

    const result = await importDocument(store, filePath, { type: 'lore' });

    assert.ok(result.chunks >= 1, 'should return chunk count');
    assert.equal(result.source, filePath);
    assert.ok(store.size() >= 1, 'store should have entries');
  });

  test('importDocument generates correct IDs from filename', async () => {
    const { importDocument } = await import('../src/knowledge.js');
    const { createStore } = await import('../src/vectorstore.js');

    const filePath = join(TEST_DIR, 'worldbuilding.txt');
    writeFileSync(filePath, 'Paragraph one.\n\nParagraph two.\n\nParagraph three.', 'utf8');

    const storePath = join(TEST_DIR, 'store2.json');
    const store = createStore(storePath);

    await importDocument(store, filePath, {});

    // IDs should follow knowledge_<basename-no-ext>_<index> pattern
    const results = store.search('paragraph', 10);
    assert.ok(results.length >= 1);
    for (const r of results) {
      assert.match(r.id, /^knowledge_worldbuilding_\d+$/);
    }
  });

  // ── queryKnowledge ───────────────────────────────────────────────────────

  test('queryKnowledge returns results', async () => {
    const { queryKnowledge } = await import('../src/knowledge.js');
    const { createStore } = await import('../src/vectorstore.js');

    const storePath = join(TEST_DIR, 'store3.json');
    const store = createStore(storePath);

    store.add('knowledge_lore_0', 'Ancient magic and dragon lore knowledge', {});
    store.add('knowledge_lore_1', 'The history of wizards and spells', {});
    store.add('knowledge_lore_2', 'Elven culture and traditions magic', {});

    const results = await queryKnowledge(store, 'magic lore', 2, null);
    assert.ok(results.length <= 2, 'should return at most k results');
    assert.ok(results.length >= 1, 'should return at least one result');
    // Each result should have expected shape
    for (const r of results) {
      assert.ok(typeof r.id === 'string');
      assert.ok(typeof r.text === 'string');
      assert.ok(typeof r.score === 'number');
    }
  });

  test('queryKnowledge filters temporally close scene entries', async () => {
    const { queryKnowledge } = await import('../src/knowledge.js');
    const { createStore } = await import('../src/vectorstore.js');

    const storePath = join(TEST_DIR, 'store4.json');
    const store = createStore(storePath);

    // Knowledge entries (no sceneIndex) — always included
    store.add('knowledge_lore_0', 'Ancient dragon lore and magic history', {});

    // Scene entries — sceneIndex within 3 of currentSceneIndex=5 should be filtered
    store.add('scene_4', 'Scene four dragon content magic lore', { sceneIndex: 4 }); // distance 1 — filtered
    store.add('scene_5', 'Scene five dragon content magic lore', { sceneIndex: 5 }); // distance 0 — filtered
    store.add('scene_6', 'Scene six dragon content magic lore', { sceneIndex: 6 }); // distance 1 — filtered
    store.add('scene_1', 'Scene one dragon magic content lore', { sceneIndex: 1 }); // distance 4 — kept

    const results = await queryKnowledge(store, 'dragon magic lore', 10, 5);

    const ids = results.map(r => r.id);

    // Scenes 4, 5, 6 should be filtered out
    assert.ok(!ids.includes('scene_4'), 'scene_4 (distance 1) should be filtered');
    assert.ok(!ids.includes('scene_5'), 'scene_5 (distance 0) should be filtered');
    assert.ok(!ids.includes('scene_6'), 'scene_6 (distance 1) should be filtered');

    // knowledge entry and distant scene should be included
    assert.ok(ids.includes('knowledge_lore_0'), 'knowledge entry should be included');
    assert.ok(ids.includes('scene_1'), 'scene_1 (distance 4) should be included');
  });
});
