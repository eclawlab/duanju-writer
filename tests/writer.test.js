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
    assert.ok(prompt.includes('音频小说作家'));
  });

  test('parseOutline validates required structure', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const valid = {
      title: 'Test Story',
      synopsis: 'A test',
      genres: ['test'],
      episodes: [{
        episodeIndex: 0,
        title: 'Ep1',
        isEnding: true,
        ending: 'GOOD',
        scenePlan: [{ summary: 'Scene 1', sceneType: 'NARRATIVE' }],
        episodeChoices: [],
      }],
    };
    const result = await parseOutline(JSON.stringify(valid));
    assert.equal(result.title, 'Test Story');
    assert.equal(result.episodes[0].scenePlan.length, 1);
  });

  test('parseOutline throws on missing title', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({ synopsis: 'A test', episodes: [{ episodeIndex: 0, title: 'E', scenePlan: [{ summary: 's' }] }] })),
      /Missing required field: title/
    );
  });

  test('parseOutline throws on missing synopsis', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({ title: 'T', episodes: [{ episodeIndex: 0, title: 'E', scenePlan: [{ summary: 's' }] }] })),
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

  test('parseOutline throws on missing episodeIndex', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({
        title: 'T', synopsis: 'S',
        episodes: [{ title: 'Ep1', scenePlan: [{ summary: 's' }] }],
      })),
      /missing episodeIndex/
    );
  });

  test('parseOutline throws on empty scenePlan', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({
        title: 'T', synopsis: 'S',
        episodes: [{ episodeIndex: 0, title: 'Ep1', isEnding: true, scenePlan: [] }],
      })),
      /at least 1 scene in scenePlan/
    );
  });

  test('parseOutline rejects duplicate episodeIndex', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({
        title: 'T', synopsis: 'S',
        episodes: [
          { episodeIndex: 0, title: 'Ep1', isEnding: true, scenePlan: [{ summary: 's' }] },
          { episodeIndex: 0, title: 'Ep2', isEnding: true, scenePlan: [{ summary: 's' }] },
        ],
      })),
      /Duplicate episodeIndex/
    );
  });

  test('parseOutline accepts linear multi-episode structure', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const result = await parseOutline(JSON.stringify({
      title: 'Linear', synopsis: 'Test',
      episodes: [
        { episodeIndex: 0, title: 'Start', isEnding: false, scenePlan: [{ summary: 's' }] },
        { episodeIndex: 1, title: 'Middle', isEnding: false, scenePlan: [{ summary: 's' }] },
        { episodeIndex: 2, title: 'End', isEnding: true, ending: 'GOOD', scenePlan: [{ summary: 's' }] },
      ],
    }));
    assert.equal(result.episodes.length, 3);
    assert.equal(result.episodes[2].isEnding, true);
  });

  test('parseOutline requires at least one ending episode', async () => {
    const { parseOutline } = await import('../src/writer.js');
    await assert.rejects(
      () => parseOutline(JSON.stringify({
        title: 'T', synopsis: 'S',
        episodes: [
          { episodeIndex: 0, title: 'Ep1', isEnding: false, scenePlan: [{ summary: 's' }] },
          { episodeIndex: 1, title: 'Ep2', isEnding: false, scenePlan: [{ summary: 's' }] },
        ],
      })),
      /ending episode/
    );
  });

  test('parseOutline strips episodeChoices from LLM output', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const result = await parseOutline(JSON.stringify({
      title: 'T', synopsis: 'S',
      episodes: [
        { episodeIndex: 0, title: 'Start', isEnding: false, scenePlan: [{ summary: 's' }],
          episodeChoices: [{ text: 'A', nextEpisodeIndex: 1 }] },
        { episodeIndex: 1, title: 'End', isEnding: true, ending: 'GOOD', scenePlan: [{ summary: 's' }] },
      ],
    }));
    assert.deepEqual(result.episodes[0].episodeChoices, []);
  });

  test('parseOutline forces characterQuestions to empty array', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const result = await parseOutline(JSON.stringify({
      title: 'T', synopsis: 'S',
      characterQuestions: [{ key: 'name', label: 'Name?' }],
      episodes: [{ episodeIndex: 0, title: 'Only', isEnding: true, ending: 'GOOD', scenePlan: [{ summary: 's' }] }],
    }));
    assert.deepEqual(result.characterQuestions, []);
  });

  test('parseOutline strips markdown code fences', async () => {
    const { parseOutline } = await import('../src/writer.js');
    const outline = {
      title: 'Fenced',
      synopsis: 'Test',
      episodes: [{ episodeIndex: 0, title: 'E1', isEnding: true, ending: 'GOOD', scenePlan: [{ summary: 's' }] }],
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

  // ─── Retry and fallback tests ──────────────────────────────────────────────

  test('buildRetryScenePrompt produces simplified prompt', async () => {
    const { buildRetryScenePrompt } = await import('../src/writer.js');
    const prompt = buildRetryScenePrompt({ summary: 'Hero enters cave', sceneType: 'NARRATIVE' });
    assert.ok(prompt.includes('Hero enters cave'));
    assert.ok(prompt.includes('NARRATIVE'));
    assert.ok(prompt.includes('JSON'));
  });

  test('buildRetryScenePrompt uses Chinese for cn lang', async () => {
    const { buildRetryScenePrompt } = await import('../src/writer.js');
    const prompt = buildRetryScenePrompt({ summary: '英雄进入洞穴', sceneType: 'NARRATIVE' }, 'cn');
    assert.ok(prompt.includes('英雄进入洞穴'));
    assert.ok(prompt.includes('JSON'));
  });

  test('buildFallbackScene creates valid scene from plan', async () => {
    const { buildFallbackScene } = await import('../src/writer.js');
    const scene = buildFallbackScene({ summary: 'The hero arrives', sceneType: 'NARRATIVE' });
    assert.ok(scene.content.includes('The hero arrives'));
    assert.equal(scene.sceneType, 'NARRATIVE');
    assert.deepEqual(scene.choices, []);
    assert.equal(scene.conclusion, null);
  });

  test('buildFallbackScene handles conclusion scenes', async () => {
    const { buildFallbackScene } = await import('../src/writer.js');
    const scene = buildFallbackScene({
      summary: 'The story ends',
      sceneType: 'NARRATIVE',
      isConclusion: true,
      conclusionType: 'EPISODE_END',
      ending: 'GOOD',
    });
    assert.ok(scene.conclusion);
    assert.equal(scene.conclusion.type, 'EPISODE_END');
    assert.equal(scene.conclusion.ending, 'GOOD');
  });

  test('buildFallbackScene handles choice scenes', async () => {
    const { buildFallbackScene } = await import('../src/writer.js');
    const scene = buildFallbackScene({
      summary: 'A fork in the road',
      sceneType: 'CHOICE',
      hasChoices: true,
      choiceTexts: ['Go left', 'Go right'],
    });
    assert.equal(scene.choices.length, 2);
    assert.equal(scene.choices[0].text, 'Go left');
    assert.equal(scene.choices[1].text, 'Go right');
  });

  // ─── Tail outline tests (variant endings) ─────────────────────────────────

  function makeBaseOutline(episodeCount = 6) {
    const episodes = [];
    for (let i = 0; i < episodeCount; i++) {
      episodes.push({
        episodeIndex: i,
        title: `Ep ${i}`,
        isEnding: i === episodeCount - 1,
        ending: i === episodeCount - 1 ? 'GOOD' : undefined,
        scenePlan: [
          { summary: `Ep${i} scene 0`, sceneType: 'NARRATIVE' },
          { summary: `Ep${i} scene 1`, sceneType: 'NARRATIVE' },
        ],
      });
    }
    return {
      title: 'Shared Story',
      synopsis: 'Premise',
      genres: ['drama'],
      episodes,
    };
  }

  test('buildTailOutlinePrompt injects split point, target ending, and prior episodes', async () => {
    const { buildTailOutlinePrompt } = await import('../src/writer.js');
    const base = makeBaseOutline(6);
    const prompt = buildTailOutlinePrompt(base, 3, 'BITTERSWEET', null);
    assert.ok(prompt.includes('BITTERSWEET'));
    assert.ok(prompt.includes('Shared Story'));
    // Prior episodes 0..2 should appear in the rendered prompt
    assert.ok(prompt.includes('Episode 0 "Ep 0"'));
    assert.ok(prompt.includes('Episode 2 "Ep 2"'));
    // The tail window metadata
    assert.ok(prompt.includes('Produce exactly 3 episodes'));
  });

  test('parseTailOutline accepts valid tail and sets ending on last episode', async () => {
    const { parseTailOutline } = await import('../src/writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 3, title: 'T1', isEnding: false, scenePlan: [{ summary: 's' }] },
        { episodeIndex: 4, title: 'T2', isEnding: false, scenePlan: [{ summary: 's' }] },
        { episodeIndex: 5, title: 'T3 Finale', isEnding: true, ending: 'SPECIAL', scenePlan: [{ summary: 's' }] },
      ],
    });
    const result = await parseTailOutline(raw, 3, 6, 'SPECIAL');
    assert.equal(result.episodes.length, 3);
    assert.equal(result.episodes[0].episodeIndex, 3);
    assert.equal(result.episodes[2].isEnding, true);
    assert.equal(result.episodes[2].ending, 'SPECIAL');
    assert.equal(result.episodes[0].isEnding, false);
    assert.equal(result.episodes[0].ending, undefined);
  });

  test('parseTailOutline coerces the last episode to target ending even if LLM emits a different one', async () => {
    const { parseTailOutline } = await import('../src/writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 2, title: 'T1', isEnding: false, scenePlan: [{ summary: 's' }] },
        { episodeIndex: 3, title: 'Finale', isEnding: true, ending: 'GOOD', scenePlan: [{ summary: 's' }] },
      ],
    });
    const result = await parseTailOutline(raw, 2, 4, 'BITTERSWEET');
    assert.equal(result.episodes[1].ending, 'BITTERSWEET');
  });

  test('parseTailOutline rejects wrong episode count', async () => {
    const { parseTailOutline } = await import('../src/writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 3, title: 'Only', isEnding: true, ending: 'GOOD', scenePlan: [{ summary: 's' }] },
      ],
    });
    await assert.rejects(
      () => parseTailOutline(raw, 3, 6, 'GOOD'),
      /exactly 3 episodes/
    );
  });

  test('parseTailOutline rejects invalid target ending', async () => {
    const { parseTailOutline } = await import('../src/writer.js');
    const raw = JSON.stringify({ episodes: [] });
    await assert.rejects(
      () => parseTailOutline(raw, 3, 6, 'TRAGIC'),
      /Invalid tail ending/
    );
  });

  test('parseTailOutline coerces misnumbered episodeIndex to expected range', async () => {
    const { parseTailOutline } = await import('../src/writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 0, title: 'T1', scenePlan: [{ summary: 's' }] },
        { episodeIndex: 1, title: 'T2', scenePlan: [{ summary: 's' }] },
        { episodeIndex: 2, title: 'T3', scenePlan: [{ summary: 's' }] },
      ],
    });
    const result = await parseTailOutline(raw, 4, 7, 'GOOD');
    assert.deepEqual(result.episodes.map(e => e.episodeIndex), [4, 5, 6]);
    assert.equal(result.episodes[2].isEnding, true);
  });

  test('parseTailOutline strips any episodeChoices the LLM emits', async () => {
    const { parseTailOutline } = await import('../src/writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 2, title: 'T1', scenePlan: [{ summary: 's' }], episodeChoices: [{ text: 'X' }] },
        { episodeIndex: 3, title: 'T2', scenePlan: [{ summary: 's' }], episodeChoices: [{ text: 'Y' }] },
      ],
    });
    const result = await parseTailOutline(raw, 2, 4, 'GOOD');
    for (const ep of result.episodes) {
      assert.deepEqual(ep.episodeChoices, []);
    }
  });

  test('VALID_TAIL_ENDINGS exposes the three supported endings', async () => {
    const { VALID_TAIL_ENDINGS } = await import('../src/writer.js');
    assert.deepEqual([...VALID_TAIL_ENDINGS].sort(), ['BITTERSWEET', 'GOOD', 'SPECIAL']);
  });
});
