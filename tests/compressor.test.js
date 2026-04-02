import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('compressor', () => {
  test('buildCompressPrompt includes scene content', async () => {
    const { buildCompressPrompt } = await import('../src/compressor.js');
    const scenes = [{ content: 'Alice enters the dark forest.' }];
    const prompt = buildCompressPrompt(scenes, 'en');
    assert.ok(prompt.includes('Alice enters the dark forest.'));
  });

  test('buildCompressPrompt includes multiple scenes', async () => {
    const { buildCompressPrompt } = await import('../src/compressor.js');
    const scenes = [
      { content: 'Scene one content.' },
      { content: 'Scene two content.' },
    ];
    const prompt = buildCompressPrompt(scenes, 'en');
    assert.ok(prompt.includes('Scene one content.'));
    assert.ok(prompt.includes('Scene two content.'));
  });

  test('buildCompressPrompt requests JSON output', async () => {
    const { buildCompressPrompt } = await import('../src/compressor.js');
    const scenes = [{ content: 'Some story content.' }];
    const prompt = buildCompressPrompt(scenes, 'en');
    assert.ok(prompt.toLowerCase().includes('json'));
  });

  test('parseCompressorOutput extracts summary fields', async () => {
    const { parseCompressorOutput } = await import('../src/compressor.js');
    const raw = JSON.stringify({
      summary: 'Hero enters the dungeon.',
      characterActions: ['Hero draws sword', 'Goblin retreats'],
      plotProgress: ['Quest begun', 'First enemy encountered'],
      emotionalArc: 'Tense and anxious',
      stateChanges: { characters: ['Hero: armed'], items: ['Sword: equipped'] },
    });
    const result = parseCompressorOutput(raw);
    assert.equal(result.summary, 'Hero enters the dungeon.');
    assert.deepEqual(result.characterActions, ['Hero draws sword', 'Goblin retreats']);
    assert.deepEqual(result.plotProgress, ['Quest begun', 'First enemy encountered']);
    assert.equal(result.emotionalArc, 'Tense and anxious');
    assert.deepEqual(result.stateChanges.characters, ['Hero: armed']);
    assert.deepEqual(result.stateChanges.items, ['Sword: equipped']);
  });

  test('parseCompressorOutput handles code fences', async () => {
    const { parseCompressorOutput } = await import('../src/compressor.js');
    const data = {
      summary: 'The village burns.',
      characterActions: ['Villain sets fire'],
      plotProgress: ['Village destroyed'],
      emotionalArc: 'Horrifying',
      stateChanges: { characters: [], items: [] },
    };
    const raw = '```json\n' + JSON.stringify(data) + '\n```';
    const result = parseCompressorOutput(raw);
    assert.equal(result.summary, 'The village burns.');
  });

  test('buildHistoryContext formats compressed scenes', async () => {
    const { buildHistoryContext } = await import('../src/compressor.js');
    const compressed = [
      {
        sceneIndex: 0,
        summary: 'Hero arrives at the castle.',
        characterActions: ['Hero knocks on gate', 'Guard challenges hero'],
        plotProgress: ['Arrival established', 'Gate blocked'],
        emotionalArc: 'Determined',
      },
      {
        sceneIndex: 1,
        summary: 'Hero sneaks inside.',
        characterActions: ['Hero climbs wall'],
        plotProgress: ['Entry achieved'],
        emotionalArc: 'Stealthy',
      },
    ];
    const result = buildHistoryContext(compressed);
    assert.ok(result.includes('Scene 1'));
    assert.ok(result.includes('Scene 2'));
    assert.ok(result.includes('Hero arrives at the castle.'));
    assert.ok(result.includes('Hero sneaks inside.'));
  });

  test('buildHistoryContext returns empty string for no history', async () => {
    const { buildHistoryContext } = await import('../src/compressor.js');
    const result = buildHistoryContext([]);
    assert.equal(result, '');
  });

  test('buildGlobalSummaryPrompt includes current summary and new content', async () => {
    const { buildGlobalSummaryPrompt } = await import('../src/compressor.js');
    const prompt = buildGlobalSummaryPrompt('Hero has entered the dungeon.', 'Hero fights a dragon.');
    assert.ok(prompt.includes('Hero has entered the dungeon.'));
    assert.ok(prompt.includes('Hero fights a dragon.'));
  });

  test('buildGlobalSummaryPrompt handles first scene (no current summary)', async () => {
    const { buildGlobalSummaryPrompt } = await import('../src/compressor.js');
    const promptNull = buildGlobalSummaryPrompt(null, 'First scene content.');
    assert.ok(promptNull.includes('No summary yet'));
    const promptEmpty = buildGlobalSummaryPrompt('', 'First scene content.');
    assert.ok(promptEmpty.includes('No summary yet'));
  });

  test('buildGlobalSummaryPrompt uses Chinese for cn lang', async () => {
    const { buildGlobalSummaryPrompt } = await import('../src/compressor.js');
    const prompt = buildGlobalSummaryPrompt('当前摘要内容', '新场景内容', 'cn');
    assert.ok(prompt.includes('你是叙事摘要专家'));
    assert.ok(prompt.includes('当前全局摘要'));
  });

  test('formatGlobalSummary returns empty string for null/empty', async () => {
    const { formatGlobalSummary } = await import('../src/compressor.js');
    assert.equal(formatGlobalSummary(null), '');
    assert.equal(formatGlobalSummary(''), '');
    assert.equal(formatGlobalSummary(undefined), '');
  });

  test('formatGlobalSummary returns summary as-is', async () => {
    const { formatGlobalSummary } = await import('../src/compressor.js');
    const summary = 'The hero has slain the dragon and claimed the treasure.';
    assert.equal(formatGlobalSummary(summary), summary);
  });
});
