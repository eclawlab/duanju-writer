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
});
