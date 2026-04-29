import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('writer', () => {
  // ─── Outline tests ──────────────────────────────────────────────────────────

  test('buildOutlinePrompt inserts materials into template', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
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
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const materials = { topics: [{ title: '测试' }], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'cn');
    assert.ok(prompt.includes('音频小说作家'));
  });

  function validOutline() {
    return {
      title: '战神归来',
      synopsis: '两句话钩子。',
      trope: '战神归来',
      genre: '都市',
      tags: ['复仇', '打脸'],
      lang: 'cn',
      characters: [
        { name: '陆衡', role: 'protagonist', description: '...' },
        { name: '苏晚', role: 'ex-wife', description: '...' },
        { name: '林董', role: 'antagonist', description: '...' },
      ],
      episodes: [
        { episodeIndex: 0, title: '第1集', isEnding: false, ending: null,
          clipPlan: [{ summary: 's', clipType: 'NARRATIVE' }] },
        { episodeIndex: 1, title: '第2集', isEnding: true, ending: '爽爆',
          clipPlan: [{ summary: 's', clipType: 'NARRATIVE' }] },
      ],
    };
  }

  test('parseOutline accepts a valid drama outline', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const result = await parseOutline(JSON.stringify(validOutline()));
    assert.equal(result.title, '战神归来');
    assert.equal(result.episodes[0].clipPlan.length, 1);
    assert.equal(result.trope, '战神归来');
  });

  test('parseOutline throws on missing title', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    delete bad.title;
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /Missing required field: title/);
  });

  test('parseOutline throws on missing synopsis', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    delete bad.synopsis;
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /Missing required field: synopsis/);
  });

  test('parseOutline throws on empty episodes', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes = [];
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /at least 2 episodes/);
  });

  test('parseOutline throws on single episode (variant pipeline requires 2+)', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes = [bad.episodes[0]];
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /at least 2 episodes/);
  });

  test('parseOutline rejects fewer than 3 characters', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.characters = [bad.characters[0], bad.characters[1]];
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /3 to 7 characters/);
  });

  test('parseOutline rejects more than 7 characters', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.characters = Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, role: 'r', description: 'd' }));
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /3 to 7 characters/);
  });

  test('parseOutline throws on missing episodeIndex', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    delete bad.episodes[0].episodeIndex;
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /missing episodeIndex/);
  });

  test('parseOutline throws on empty clipPlan', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[0].clipPlan = [];
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /at least 1 clip in clipPlan/);
  });

  test('parseOutline rejects duplicate episodeIndex', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[1].episodeIndex = 0;
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /Duplicate episodeIndex/);
  });

  test('parseOutline rejects missing isEnding on final episode', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[1].isEnding = false;
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /Final episode must have isEnding/);
  });

  test('parseOutline rejects invalid ending value', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[1].ending = 'GOOD';  // legacy enum, no longer accepted
    await assert.rejects(() => parseOutline(JSON.stringify(bad)), /ending must be one of/);
  });

  test('parseOutline accepts linear multi-episode structure', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const valid = validOutline();
    valid.episodes = [
      { episodeIndex: 0, title: '第1集', isEnding: false, ending: null, clipPlan: [{ summary: 's' }] },
      { episodeIndex: 1, title: '第2集', isEnding: false, ending: null, clipPlan: [{ summary: 's' }] },
      { episodeIndex: 2, title: '第3集', isEnding: true, ending: '反转', clipPlan: [{ summary: 's' }] },
    ];
    const result = await parseOutline(JSON.stringify(valid));
    assert.equal(result.episodes.length, 3);
    assert.equal(result.episodes[2].isEnding, true);
    assert.equal(result.episodes[2].ending, '反转');
  });

  test('parseOutline strips episodeChoices from LLM output', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const valid = validOutline();
    valid.episodes[0].episodeChoices = [{ text: 'A', nextEpisodeIndex: 1 }];
    const result = await parseOutline(JSON.stringify(valid));
    assert.deepEqual(result.episodes[0].episodeChoices, []);
  });

  test('parseOutline forces characterQuestions to empty array', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const valid = validOutline();
    valid.characterQuestions = [{ key: 'name', label: 'Name?' }];
    const result = await parseOutline(JSON.stringify(valid));
    assert.deepEqual(result.characterQuestions, []);
  });

  test('parseOutline strips markdown code fences', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const wrapped = '```json\n' + JSON.stringify(validOutline()) + '\n```';
    const result = await parseOutline(wrapped);
    assert.equal(result.title, '战神归来');
  });

  // ─── Scene tests ────────────────────────────────────────────────────────────

  function clipCtx() {
    return {
      outline: {
        title: '战神归来',
        synopsis: '钩子',
        characters: [{ name: '陆衡', role: 'p', description: 'd' }],
      },
      episode: { episodeIndex: 0, title: '第1集', clipPlan: [{ summary: '登场', isConclusion: false }] },
      clipIndex: 0,
      totalClips: 6,
      clipSummary: '陆衡推门归来',
      isConclusion: false,
      priorClipDigest: '',
      tropeSection: '## Clip\n短促对白，反问句多。',
    };
  }

  test('buildClipPrompt injects clipIndex, totalClips, summary', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(clipCtx());
    assert.match(p, /片段\s*0\s*\/\s*6/);
    assert.match(p, /陆衡推门归来/);
    assert.match(p, /战神归来/);
  });

  test('buildClipPrompt injects trope ## Clip section', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(clipCtx());
    assert.match(p, /短促对白，反问句多/);
  });

  test('buildClipPrompt forbids voice IDs and [player] blocks (in the 严禁 section)', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(clipCtx());
    // The prompt MAY mention these markers, but only in a forbidden list.
    assert.ok(/不写\s*\|voice:/.test(p) || /不\s*要.*voice/i.test(p), 'prompt should explicitly forbid |voice: markers');
    assert.ok(/不写\s*\[player\]/.test(p), 'prompt should explicitly forbid [player] blocks');
  });

  test('buildClipPrompt marks conclusion clip context when isConclusion=true', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const c = clipCtx();
    c.isConclusion = true;
    const p = buildClipPrompt(c);
    assert.match(p, /是否结局片段：true/);
  });

  function validClip() {
    return {
      clipIndex: 0,
      setting: '豪门别墅 · 夜 · 暴雨',
      action: '陆衡推开大门，浑身湿透站在前妻苏晚面前。',
      dialogue: '[narrator]\n五年了。\n[character:陆衡]\n我回来了。',
      hook: '苏晚的手机响起，来电显示：林董事长。',
      durationSec: 12,
      isConclusion: false,
      conclusion: null,
    };
  }

  test('parseClip accepts a valid clip', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const result = await parseClip(JSON.stringify(validClip()));
    assert.equal(result.clipIndex, 0);
    assert.ok(result.hook && result.hook.length > 0);
  });

  test('parseClip rejects missing hook on non-conclusion clip', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.hook = '';
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /hook required/);
  });

  test('parseClip rejects dialogue exceeding 60 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.dialogue = '[narrator]\n' + '一'.repeat(70);
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /dialogue.*60/);
  });

  test('parseClip rejects action exceeding 80 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.action = '一'.repeat(90);
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /action.*80/);
  });

  test('parseClip rejects setting exceeding 20 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.setting = '一'.repeat(25);
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /setting.*20/);
  });

  test('parseClip rejects hook exceeding 30 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.hook = '一'.repeat(35);
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /hook.*30/);
  });

  test('parseClip allows empty hook on conclusion clip with valid conclusion object', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const c = validClip();
    c.isConclusion = true;
    c.hook = '';
    c.conclusion = { title: '结局', overview: '...', type: 'DRAMA_END', ending: '爽爆' };
    const result = await parseClip(JSON.stringify(c));
    assert.equal(result.isConclusion, true);
    assert.equal(result.conclusion.type, 'DRAMA_END');
  });

  test('parseClip rejects conclusion clip with wrong conclusion.type', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.isConclusion = true;
    bad.hook = '';
    bad.conclusion = { title: 't', overview: 'o', type: 'STORY_END', ending: '爽爆' };
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /conclusion\.type.*DRAMA_END/);
  });

  test('parseClip strips voice IDs and player blocks from dialogue', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.dialogue = '[character:陆衡|voice:alloy]\n来了\n[player]\n好的';
    const result = await parseClip(JSON.stringify(bad));
    assert.ok(!result.dialogue.includes('|voice:'));
    assert.ok(!result.dialogue.includes('[player]'));
  });

  test('parseClip strips markdown code fences', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const wrapped = '```json\n' + JSON.stringify(validClip()) + '\n```';
    const result = await parseClip(wrapped);
    assert.equal(result.clipIndex, 0);
  });

  // ─── Retry and fallback tests ──────────────────────────────────────────────

  test('buildRetryClipPrompt produces simplified prompt with summary and JSON instruction', async () => {
    const { buildRetryClipPrompt } = await import('../src/drama-writer.js');
    const prompt = buildRetryClipPrompt({ clipSummary: '陆衡推门归来', prevError: 'invalid hook' });
    assert.match(prompt, /陆衡推门归来/);
    assert.match(prompt, /JSON/);
    assert.match(prompt, /invalid hook/);
    assert.match(prompt, /hook≤30/);
  });

  test('buildRetryClipPrompt swaps to conclusion-mode tail when isConclusion=true', async () => {
    const { buildRetryClipPrompt } = await import('../src/drama-writer.js');
    const prompt = buildRetryClipPrompt({ clipSummary: '终极爆点', isConclusion: true, ending: '反转' });
    assert.match(prompt, /DRAMA_END/);
    assert.match(prompt, /反转/);
  });

  test('buildFallbackClip produces a parser-valid clip from plan data', async () => {
    const { buildFallbackClip, parseClip } = await import('../src/drama-writer.js');
    const c = buildFallbackClip({ clipIndex: 2, summary: '陆衡推门进入豪门', isConclusion: false });
    // Must round-trip through parseClip without throwing
    const parsed = await parseClip(JSON.stringify(c));
    assert.equal(parsed.clipIndex, 2);
    assert.ok(parsed.hook && parsed.hook.length > 0);
  });

  test('buildFallbackClip produces a valid conclusion clip when isConclusion=true', async () => {
    const { buildFallbackClip, parseClip } = await import('../src/drama-writer.js');
    const c = buildFallbackClip({ clipIndex: 5, summary: '陆衡身份揭露', isConclusion: true, ending: '爽爆' });
    const parsed = await parseClip(JSON.stringify(c));
    assert.equal(parsed.isConclusion, true);
    assert.equal(parsed.conclusion.type, 'DRAMA_END');
    assert.equal(parsed.conclusion.ending, '爽爆');
  });

  // (legacy buildFallbackClip "handles conclusion/choice clips" tests retired —
  // drama pipeline has no choices and conclusion type is locked to DRAMA_END.)

  // ─── Tail outline tests (variant endings) ─────────────────────────────────

  function makeBaseOutline(episodeCount = 6) {
    const episodes = [];
    for (let i = 0; i < episodeCount; i++) {
      episodes.push({
        episodeIndex: i,
        title: `Ep ${i}`,
        isEnding: i === episodeCount - 1,
        ending: i === episodeCount - 1 ? '爽爆' : undefined,
        clipPlan: [
          { summary: `Ep${i} scene 0`, clipType: 'NARRATIVE' },
          { summary: `Ep${i} scene 1`, clipType: 'NARRATIVE' },
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
    const { buildTailOutlinePrompt } = await import('../src/drama-writer.js');
    const base = makeBaseOutline(6);
    const prompt = buildTailOutlinePrompt(base, 3, '苦尽甘来', null);
    assert.ok(prompt.includes('苦尽甘来'));
    assert.ok(prompt.includes('Shared Story'));
    // Prior episodes 0..2 should appear in the rendered prompt
    assert.ok(prompt.includes('Episode 0 "Ep 0"'));
    assert.ok(prompt.includes('Episode 2 "Ep 2"'));
    // The tail window metadata
    assert.ok(prompt.includes('Produce exactly 3 episodes'));
  });

  test('parseTailOutline accepts valid tail and sets ending on last episode', async () => {
    const { parseTailOutline } = await import('../src/drama-writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 3, title: 'T1', isEnding: false, clipPlan: [{ summary: 's' }] },
        { episodeIndex: 4, title: 'T2', isEnding: false, clipPlan: [{ summary: 's' }] },
        { episodeIndex: 5, title: 'T3 Finale', isEnding: true, ending: '反转', clipPlan: [{ summary: 's' }] },
      ],
    });
    const result = await parseTailOutline(raw, 3, 6, '反转');
    assert.equal(result.episodes.length, 3);
    assert.equal(result.episodes[0].episodeIndex, 3);
    assert.equal(result.episodes[2].isEnding, true);
    assert.equal(result.episodes[2].ending, '反转');
    assert.equal(result.episodes[0].isEnding, false);
    assert.equal(result.episodes[0].ending, undefined);
  });

  test('parseTailOutline coerces the last episode to target ending even if LLM emits a different one', async () => {
    const { parseTailOutline } = await import('../src/drama-writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 2, title: 'T1', isEnding: false, clipPlan: [{ summary: 's' }] },
        { episodeIndex: 3, title: 'Finale', isEnding: true, ending: '爽爆', clipPlan: [{ summary: 's' }] },
      ],
    });
    const result = await parseTailOutline(raw, 2, 4, '苦尽甘来');
    assert.equal(result.episodes[1].ending, '苦尽甘来');
  });

  test('parseTailOutline rejects wrong episode count', async () => {
    const { parseTailOutline } = await import('../src/drama-writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 3, title: 'Only', isEnding: true, ending: '爽爆', clipPlan: [{ summary: 's' }] },
      ],
    });
    await assert.rejects(
      () => parseTailOutline(raw, 3, 6, '爽爆'),
      /exactly 3 episodes/
    );
  });

  test('parseTailOutline rejects invalid target ending', async () => {
    const { parseTailOutline } = await import('../src/drama-writer.js');
    const raw = JSON.stringify({ episodes: [] });
    await assert.rejects(
      () => parseTailOutline(raw, 3, 6, 'TRAGIC'),
      /Invalid tail ending/
    );
  });

  test('parseTailOutline coerces misnumbered episodeIndex to expected range', async () => {
    const { parseTailOutline } = await import('../src/drama-writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 0, title: 'T1', clipPlan: [{ summary: 's' }] },
        { episodeIndex: 1, title: 'T2', clipPlan: [{ summary: 's' }] },
        { episodeIndex: 2, title: 'T3', clipPlan: [{ summary: 's' }] },
      ],
    });
    const result = await parseTailOutline(raw, 4, 7, '爽爆');
    assert.deepEqual(result.episodes.map(e => e.episodeIndex), [4, 5, 6]);
    assert.equal(result.episodes[2].isEnding, true);
  });

  test('parseTailOutline strips any episodeChoices the LLM emits', async () => {
    const { parseTailOutline } = await import('../src/drama-writer.js');
    const raw = JSON.stringify({
      episodes: [
        { episodeIndex: 2, title: 'T1', clipPlan: [{ summary: 's' }], episodeChoices: [{ text: 'X' }] },
        { episodeIndex: 3, title: 'T2', clipPlan: [{ summary: 's' }], episodeChoices: [{ text: 'Y' }] },
      ],
    });
    const result = await parseTailOutline(raw, 2, 4, '爽爆');
    for (const ep of result.episodes) {
      assert.deepEqual(ep.episodeChoices, []);
    }
  });

  test('VALID_TAIL_ENDINGS exposes the three supported endings', async () => {
    const { VALID_TAIL_ENDINGS } = await import('../src/drama-writer.js');
    assert.deepEqual([...VALID_TAIL_ENDINGS].sort(), ['反转', '爽爆', '苦尽甘来']);
  });
});
