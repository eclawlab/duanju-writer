import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('collector', () => {
  test('buildResearchPrompt inserts history into template', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const history = [
      { topic: 'space opera', genres: ['sci-fi'] },
      { topic: 'vampire romance', genres: ['romance', 'horror'] },
    ];
    const prompt = buildResearchPrompt(history, 'some web research');
    assert.ok(prompt.includes('space opera (sci-fi)'));
    assert.ok(prompt.includes('vampire romance (romance, horror)'));
  });

  test('buildResearchPrompt works with empty history', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const prompt = buildResearchPrompt([], 'web data');
    assert.ok(prompt.includes('(none — this is the first run)'));
  });

  test('buildResearchPrompt includes template instructions', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const prompt = buildResearchPrompt([], 'web data');
    assert.ok(prompt.includes('trending fiction'));
    assert.ok(prompt.includes('Output Format'));
  });

  test('buildResearchPrompt handles history with empty genres', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const history = [{ topic: 'test topic', genres: [] }];
    const prompt = buildResearchPrompt(history, 'web data');
    assert.ok(prompt.includes('test topic ()'));
  });

  test('buildResearchPrompt handles history without genres field', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const history = [{ topic: 'no genres' }];
    const prompt = buildResearchPrompt(history, 'web data');
    assert.ok(prompt.includes('no genres'));
  });

  test('buildResearchPrompt injects web research content', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const webResearch = '### Search: "trending stories"\n- Story A: great story';
    const prompt = buildResearchPrompt([], webResearch);
    assert.ok(prompt.includes('### Search: "trending stories"'));
    assert.ok(prompt.includes('Story A: great story'));
  });

  test('buildResearchPrompt handles missing web research', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const prompt = buildResearchPrompt([], null);
    assert.ok(prompt.includes('(no web research available)'));
  });

  test('parseMaterials validates required fields', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    const valid = { topics: [{ title: 'Test' }], characterIdeas: [], plotHooks: ['hook'], genres: [] };
    const result = await parseMaterials(JSON.stringify(valid));
    assert.equal(result.topics[0].title, 'Test');
    assert.deepEqual(result.plotHooks, ['hook']);
  });

  test('parseMaterials throws on missing topics', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    const noTopics = { characterIdeas: [], plotHooks: ['hook'], genres: [] };
    await assert.rejects(() => parseMaterials(JSON.stringify(noTopics)), /Missing topics array/);
  });

  test('parseMaterials throws on missing plotHooks', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    const noHooks = { topics: [{ title: 'Test' }], characterIdeas: [], genres: [] };
    await assert.rejects(() => parseMaterials(JSON.stringify(noHooks)), /Missing plotHooks array/);
  });

  test('parseMaterials strips markdown code fences', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    const json = JSON.stringify({ topics: [{ title: 'Test' }], plotHooks: ['hook'] });
    const wrapped = '```json\n' + json + '\n```';
    const result = await parseMaterials(wrapped);
    assert.equal(result.topics[0].title, 'Test');
  });

  test('parseMaterials strips code fences without language tag', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    const json = JSON.stringify({ topics: [{ title: 'Bare' }], plotHooks: ['h'] });
    const wrapped = '```\n' + json + '\n```';
    const result = await parseMaterials(wrapped);
    assert.equal(result.topics[0].title, 'Bare');
  });

  test('parseMaterials throws when topics is not an array', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    await assert.rejects(
      () => parseMaterials(JSON.stringify({ topics: 'not-array', plotHooks: [] })),
      /Missing topics array/
    );
  });

  test('parseMaterials throws when plotHooks is not an array', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    await assert.rejects(
      () => parseMaterials(JSON.stringify({ topics: [], plotHooks: 'not-array' })),
      /Missing plotHooks array/
    );
  });

  test('buildResearchPrompt uses CN template when lang is cn', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const prompt = buildResearchPrompt([], 'web data', 'cn');
    assert.ok(prompt.includes('小说研究助手'));
    assert.ok(prompt.includes('web data'));
  });

  test('buildResearchPrompt CN uses Chinese empty history text', async () => {
    const { buildResearchPrompt } = await import('../src/collector.js');
    const prompt = buildResearchPrompt([], null, 'cn');
    assert.ok(prompt.includes('（无——这是首次运行）'));
    assert.ok(prompt.includes('（无网络研究数据）'));
  });

  test('parseMaterials preserves all returned fields', async () => {
    const { parseMaterials } = await import('../src/collector.js');
    const data = {
      topics: [{ title: 'T', premise: 'P', appeal: 'A' }],
      characterIdeas: [{ archetype: 'Hero', twist: 'Is a ghost' }],
      plotHooks: ['A mysterious letter arrives'],
      genres: ['fantasy', 'mystery'],
      fandom: 'Original',
      sources: ['https://example.com'],
    };
    const result = await parseMaterials(JSON.stringify(data));
    assert.deepEqual(result.genres, ['fantasy', 'mystery']);
    assert.equal(result.fandom, 'Original');
    assert.equal(result.characterIdeas[0].archetype, 'Hero');
    assert.deepEqual(result.sources, ['https://example.com']);
  });
});
