import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('writer', () => {
  // ─── Outline tests ──────────────────────────────────────────────────────────

  test('buildOutlinePrompt inserts materials into template', async () => {
    const { buildOutlinePrompt } = await import('../src/writer.js');
    const materials = {
      topics: [{ title: 'AI Rebellion', premise: 'Robots gain consciousness' }],
      plotHooks: ['The last human city receives a transmission'],
      genres: ['sci-fi', 'thriller'],
    };
    const prompt = buildOutlinePrompt(materials);
    assert.ok(prompt.includes('AI Rebellion'));
    assert.ok(prompt.includes('last human city'));
  });

  test('buildOutlinePrompt uses CN template when lang is cn', async () => {
    const { buildOutlinePrompt } = await import('../src/writer.js');
    const materials = { topics: [{ title: '测试' }], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'cn');
    assert.ok(prompt.includes('互动小说作家'));
  });

  test('parseOutline validates required structure', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const valid = {
      title: 'Test Story',
      synopsis: 'A test',
      genres: ['test'],
      episodes: [{
        title: 'Ep1',
        scenePlan: [{ summary: 'Scene 1', sceneType: 'NARRATIVE' }],
      }],
    };
    const result = await parseOutline(JSON.stringify(valid));
    assert.equal(result.title, 'Test Story');
    assert.equal(result.episodes[0].scenePlan.length, 1);
  });

  test('parseOutline throws on missing title', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({ synopsis: 'A test', episodes: [{ title: 'E', scenePlan: [{ summary: 's' }] }] })),
      /Missing required field: title/
    );
  });

  test('parseOutline throws on missing synopsis', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({ title: 'T', episodes: [{ title: 'E', scenePlan: [{ summary: 's' }] }] })),
      /Missing required field: synopsis/
    );
  });

  test('parseOutline throws on empty episodes', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({ title: 'T', synopsis: 'S', episodes: [] })),
      /at least 1 episode/
    );
  });

  test('parseOutline throws on empty scenePlan', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({
        title: 'T', synopsis: 'S',
        episodes: [{ title: 'Ep1', scenePlan: [] }],
      })),
      /at least 1 scene in scenePlan/
    );
  });

  test('parseOutline strips markdown code fences', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const outline = {
      title: 'Fenced',
      synopsis: 'Test',
      episodes: [{ title: 'E1', scenePlan: [{ summary: 's' }] }],
    };
    const wrapped = '```json\n' + JSON.stringify(outline) + '\n```';
    const result = await parseOutline(wrapped);
    assert.equal(result.title, 'Fenced');
  });

  // ─── Scene tests ────────────────────────────────────────────────────────────

  test('buildScenePrompt inserts outline and scene details', async () => {
    const { buildScenePrompt } = await import('../src/writer.js');
    const outline = {
      title: 'Test Story',
      synopsis: 'A test',
      genres: ['fantasy'],
      episodes: [{
        title: 'Ep1',
        scenePlan: [
          { summary: 'Hero arrives', sceneType: 'NARRATIVE' },
          { summary: 'Hero chooses', sceneType: 'CHOICE', hasChoices: true, choiceTexts: ['Fight', 'Flee'] },
        ],
      }],
    };
    const prompt = buildScenePrompt(outline, 0, outline.episodes[0].scenePlan[0], 2);
    assert.ok(prompt.includes('Test Story'));
    assert.ok(prompt.includes('Hero arrives'));
    assert.ok(prompt.includes('1'));
    assert.ok(prompt.includes('2'));
  });

  test('buildScenePrompt includes choice texts for CHOICE scenes', async () => {
    const { buildScenePrompt } = await import('../src/writer.js');
    const outline = {
      title: 'T', synopsis: 'S', genres: [],
      episodes: [{ title: 'E', scenePlan: [{ summary: 'Choose', sceneType: 'CHOICE', hasChoices: true, choiceTexts: ['A', 'B'] }] }],
    };
    const prompt = buildScenePrompt(outline, 0, outline.episodes[0].scenePlan[0], 1);
    assert.ok(prompt.includes('A, B'));
  });

  test('buildScenePrompt includes conclusion info', async () => {
    const { buildScenePrompt } = await import('../src/writer.js');
    const outline = {
      title: 'T', synopsis: 'S', genres: [],
      episodes: [{ title: 'E', scenePlan: [{ summary: 'End', sceneType: 'NARRATIVE', isConclusion: true, conclusionType: 'EPISODE_END', ending: 'GOOD' }] }],
    };
    const prompt = buildScenePrompt(outline, 0, outline.episodes[0].scenePlan[0], 1);
    assert.ok(prompt.includes('EPISODE_END'));
    assert.ok(prompt.includes('GOOD'));
  });

  test('buildScenePrompt uses CN template when lang is cn', async () => {
    const { buildScenePrompt } = await import('../src/writer.js');
    const outline = {
      title: '测试', synopsis: '简介', genres: [],
      episodes: [{ title: '章节', scenePlan: [{ summary: '场景', sceneType: 'NARRATIVE' }] }],
    };
    const prompt = buildScenePrompt(outline, 0, outline.episodes[0].scenePlan[0], 1, 'cn');
    assert.ok(prompt.includes('互动小说作家'));
  });

  test('parseScene validates content field', async () => {
    const { parseScene } = await import('../src/writer.js');
    const valid = { content: '[narrator]\nHello', sceneType: 'NARRATIVE', choices: [], conclusion: null };
    const result = await parseScene(JSON.stringify(valid));
    assert.equal(result.content, '[narrator]\nHello');
  });

  test('parseScene throws on missing content', async () => {
    const { parseScene } = await import('../src/writer.js');
    await assert.rejects(
      () => parseScene(JSON.stringify({ sceneType: 'NARRATIVE' })),
      /Scene missing content/
    );
  });

  test('parseScene strips code fences', async () => {
    const { parseScene } = await import('../src/writer.js');
    const scene = { content: '[narrator]\nTest', sceneType: 'NARRATIVE' };
    const wrapped = '```json\n' + JSON.stringify(scene) + '\n```';
    const result = await parseScene(wrapped);
    assert.equal(result.content, '[narrator]\nTest');
  });
});
