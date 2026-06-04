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
    assert.ok(prompt.includes('短剧编剧'));
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

  test('buildClipPrompt injects author voice when authorVoice set', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const c = clipCtx();
    c.authorVoice = 'Dense, sensory prose: smells, textures, magical realism.';
    const p = buildClipPrompt(c);
    assert.match(p, /文风|Author Voice/);
    assert.match(p, /Dense, sensory prose/);
  });

  test('buildClipPrompt omits author-voice block when authorVoice empty', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(clipCtx());
    assert.ok(!/## 文风 \/ Author Voice/.test(p), 'no voice block when authorVoice unset');
  });

  test('buildRetryClipPrompt carries author voice when set', async () => {
    const { buildRetryClipPrompt } = await import('../src/drama-writer.js');
    const prompt = buildRetryClipPrompt({
      clipSummary: '陆衡推门归来',
      prevError: 'bad',
      authorVoice: 'Magical realism, cyclical narrative echoes.',
    });
    assert.match(prompt, /Magical realism, cyclical narrative echoes/);
  });

  test('buildRetryClipPrompt has no voice line when authorVoice empty', async () => {
    const { buildRetryClipPrompt } = await import('../src/drama-writer.js');
    const prompt = buildRetryClipPrompt({ clipSummary: 'x', prevError: 'y' });
    assert.ok(!/文风（仅影响遣词/.test(prompt));
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

  test('parseClip throws on missing clipIndex when no fallback is supplied', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    delete bad.clipIndex;
    await assert.rejects(() => parseClip(JSON.stringify(bad)), /missing clipIndex/);
  });

  test('parseClip uses the caller-supplied clipIndex when the model omits it', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    delete bad.clipIndex;
    const result = await parseClip(JSON.stringify(bad), { clipIndex: 3 });
    assert.equal(result.clipIndex, 3);
    assert.ok(result.content && result.content.length > 0);
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
    assert.equal(result.conclusion.type, 'STORY_END');
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

  describe('buildFallbackClip — scene shape', () => {
    test('non-conclusion fallback returns scene shape with enumerable beats', async () => {
      const { buildFallbackClip } = await import('../src/drama-writer.js');
      const scene = buildFallbackClip({ clipIndex: 5, summary: '陆衡推门', isConclusion: false });
      assert.equal(typeof scene.content, 'string');
      assert.ok(scene.content.length > 0);
      assert.deepEqual(scene.choices, []);
      assert.equal(scene.conclusion, null);
      assert.equal(typeof scene.setting, 'string');
      assert.equal(typeof scene.hook, 'string');
    });

    test('conclusion fallback maps 爽爆 to GOOD and type STORY_END', async () => {
      const { buildFallbackClip } = await import('../src/drama-writer.js');
      const scene = buildFallbackClip({ clipIndex: 9, summary: '终局', isConclusion: true, ending: '爽爆' });
      assert.equal(scene.conclusion.type, 'STORY_END');
      assert.equal(scene.conclusion.ending, 'GOOD');
    });

    test('fallback exposes structured beats on the scene itself', async () => {
      const { buildFallbackClip } = await import('../src/drama-writer.js');
      const scene = buildFallbackClip({ clipIndex: 3, summary: 'sx' });
      assert.equal(scene.clipIndex, 3);
      assert.ok(typeof scene.setting === 'string');
      assert.ok(typeof scene.action === 'string');
      assert.ok(typeof scene.dialogue === 'string');
      assert.equal(typeof scene.durationSec, 'number');
    });

    test('fallback JSON.stringify carries beats through to the wire', async () => {
      const { buildFallbackClip } = await import('../src/drama-writer.js');
      const scene = buildFallbackClip({ clipIndex: 0, summary: 'x' });
      const json = JSON.stringify(scene);
      assert.ok(json.includes('"setting"'), 'setting missing from wire');
      assert.ok(json.includes('"action"'), 'action missing from wire');
      assert.ok(json.includes('"dialogue"'), 'dialogue missing from wire');
      assert.ok(json.includes('"durationSec"'), 'durationSec missing from wire');
      assert.ok(!json.includes('"_beats"'), '_beats should not appear at all');
    });
  });

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

  describe('composeScene', () => {
    test('joins setting / action / dialogue / hook into block-format content', async () => {
      const { composeScene } = await import('../src/drama-writer.js');
      const content = composeScene({
        setting: '夜雨破庙',
        action: '陆衡踉跄推门',
        dialogue: '[narrator]\n气氛凝重\n[character:陆衡]\n三年了',
        hook: '身后传来摩托引擎声',
      });
      assert.equal(
        content,
        '[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门\n\n[narrator]\n气氛凝重\n[character:陆衡]\n三年了\n\n[narrator]\n身后传来摩托引擎声'
      );
    });

    test('omits the setting block when setting is empty', async () => {
      const { composeScene } = await import('../src/drama-writer.js');
      const content = composeScene({
        setting: '',
        action: '陆衡推门',
        dialogue: '[narrator]\n气氛凝重',
        hook: '钩点',
      });
      assert.equal(content, '[narrator]\n陆衡推门\n\n[narrator]\n气氛凝重\n\n[narrator]\n钩点');
    });

    test('omits the hook block when hook is empty (conclusion clip)', async () => {
      const { composeScene } = await import('../src/drama-writer.js');
      const content = composeScene({
        setting: '终幕',
        action: '灯熄',
        dialogue: '[character:陆衡]\n这局我赢',
        hook: '',
      });
      assert.equal(content, '[narrator]\n终幕\n\n[narrator]\n灯熄\n\n[character:陆衡]\n这局我赢');
    });

    test('throws when composition would produce empty content', async () => {
      const { composeScene } = await import('../src/drama-writer.js');
      assert.throws(
        () => composeScene({ setting: '', action: '', dialogue: '', hook: '' }),
        /empty content/
      );
    });
  });

  describe('ENDING_LABEL_TO_ENUM', () => {
    test('maps 爽爆 to GOOD', async () => {
      const { ENDING_LABEL_TO_ENUM } = await import('../src/drama-writer.js');
      assert.equal(ENDING_LABEL_TO_ENUM['爽爆'], 'GOOD');
    });
    test('maps 苦尽甘来 to NEUTRAL', async () => {
      const { ENDING_LABEL_TO_ENUM } = await import('../src/drama-writer.js');
      assert.equal(ENDING_LABEL_TO_ENUM['苦尽甘来'], 'NEUTRAL');
    });
    test('maps 反转 to SPECIAL', async () => {
      const { ENDING_LABEL_TO_ENUM } = await import('../src/drama-writer.js');
      assert.equal(ENDING_LABEL_TO_ENUM['反转'], 'SPECIAL');
    });
  });

  describe('parseClip — scene shape', () => {
    function rawClip(overrides = {}) {
      return JSON.stringify({
        clipIndex: 0,
        setting: '夜雨破庙',
        action: '陆衡踉跄推门',
        dialogue: '[character:陆衡]\n三年了',
        hook: '摩托声渐近',
        durationSec: 12,
        isConclusion: false,
        conclusion: null,
        ...overrides,
      });
    }

    test('returns { content, choices, conclusion } shape with enumerable beats', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip());
      assert.equal(typeof scene.content, 'string');
      assert.ok(scene.content.length > 0);
      assert.deepEqual(scene.choices, []);
      assert.equal(scene.conclusion, null);
      const enumerableKeys = Object.keys(scene);
      assert.ok(enumerableKeys.includes('setting'), `setting should be enumerable, got keys: ${enumerableKeys}`);
      assert.ok(enumerableKeys.includes('action'), 'action should be enumerable');
      assert.ok(enumerableKeys.includes('dialogue'), 'dialogue should be enumerable');
      assert.ok(enumerableKeys.includes('hook'), 'hook should be enumerable');
    });

    test('JSON.stringify(scene) carries beats through to the wire', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip());
      const json = JSON.stringify(scene);
      assert.ok(json.includes('"setting"'), 'setting missing from wire');
      assert.ok(json.includes('"hook"'), 'hook missing from wire');
      assert.ok(json.includes('"action"'), 'action missing from wire');
      assert.ok(json.includes('"durationSec"'), 'durationSec missing from wire');
      assert.ok(!json.includes('"_beats"'), '_beats ride-along should not appear');
    });

    test('beats are exposed on the scene object alongside content', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip());
      assert.equal(scene.setting, '夜雨破庙');
      assert.equal(scene.action, '陆衡踉跄推门');
      assert.equal(scene.dialogue, '[character:陆衡]\n三年了');
      assert.equal(scene.hook, '摩托声渐近');
      assert.equal(scene.durationSec, 12);
      assert.equal(scene.clipIndex, 0);
      assert.equal(scene.isConclusion, false);
    });

    test('content is composed from beats per the composition rule', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip());
      assert.equal(
        scene.content,
        '[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门\n\n[character:陆衡]\n三年了\n\n[narrator]\n摩托声渐近'
      );
    });

    test('conclusion clip with 爽爆 → conclusion.ending GOOD, type STORY_END', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip({
        isConclusion: true,
        hook: '',
        conclusion: { title: '结局：碾压', overview: '反派全员跪地', type: 'DRAMA_END', ending: '爽爆' },
      }));
      assert.equal(scene.conclusion.type, 'STORY_END');
      assert.equal(scene.conclusion.ending, 'GOOD');
      assert.equal(scene.conclusion.title, '结局：碾压');
      assert.equal(scene.conclusion.overview, '反派全员跪地');
    });

    test('conclusion clip with 苦尽甘来 → NEUTRAL', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip({
        isConclusion: true,
        hook: '',
        conclusion: { title: 't', overview: 'o', type: 'DRAMA_END', ending: '苦尽甘来' },
      }));
      assert.equal(scene.conclusion.ending, 'NEUTRAL');
    });

    test('conclusion clip with 反转 → SPECIAL', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const scene = await parseClip(rawClip({
        isConclusion: true,
        hook: '',
        conclusion: { title: 't', overview: 'o', type: 'DRAMA_END', ending: '反转' },
      }));
      assert.equal(scene.conclusion.ending, 'SPECIAL');
    });

    test('still throws on missing dialogue (existing per-beat validation runs first)', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      await assert.rejects(
        () => parseClip(rawClip({ dialogue: '' })),
        /clip missing dialogue/
      );
    });

    test('still throws on dialogue exceeding CN-char limit (60)', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      const long = '一'.repeat(70);
      await assert.rejects(
        () => parseClip(rawClip({ dialogue: long })),
        /dialogue.*max 60/
      );
    });

    test('still throws on missing hook for non-conclusion clip', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      await assert.rejects(
        () => parseClip(rawClip({ hook: '' })),
        /hook required/
      );
    });

    test('still throws on conclusion clip with invalid ending label', async () => {
      const { parseClip } = await import('../src/drama-writer.js');
      await assert.rejects(
        () => parseClip(rawClip({
          isConclusion: true,
          hook: '',
          conclusion: { title: 't', overview: 'o', type: 'DRAMA_END', ending: 'BE' },
        })),
        /ending must be one of/
      );
    });
  });
});

describe('outline bible injection', () => {
  test('buildOutlinePrompt with bible+fidelity appends bible block and chapter-range instruction', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const out = buildOutlinePrompt({}, 'cn', '', '', '', '', { bible, fidelity: 'tight', totalChapters: 3 });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('sourceChapterRange'));
    assert.ok(out.includes('tight'));
    assert.ok(out.includes('[1..3]'));
  });

  test('buildOutlinePrompt without bible omits bible block', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const out = buildOutlinePrompt({}, 'cn', '');
    assert.ok(!out.includes('## 参考小说'));
    assert.ok(!out.includes('sourceChapterRange'));
  });
});

describe('validateOutlineChapterCoverage', () => {
  test('rejects tight outline missing sourceChapterRange on any episode', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [
      { episodeIndex: 0, sourceChapterRange: [1, 2] },
      { episodeIndex: 1 },
    ]};
    assert.throws(
      () => validateOutlineChapterCoverage(outline, 'tight', 4),
      /sourceChapterRange/
    );
  });

  test('rejects tight outline whose ranges do not cover [1..N]', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [
      { episodeIndex: 0, sourceChapterRange: [1, 2] },
      { episodeIndex: 1, sourceChapterRange: [4, 5] },
    ]};
    assert.throws(
      () => validateOutlineChapterCoverage(outline, 'tight', 5),
      /coverage|gap/i
    );
  });

  test('passes for tight outline covering [1..N]', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [
      { episodeIndex: 0, sourceChapterRange: [1, 2] },
      { episodeIndex: 1, sourceChapterRange: [3, 5] },
    ]};
    assert.doesNotThrow(() => validateOutlineChapterCoverage(outline, 'tight', 5));
  });

  test('is a no-op for medium and loose fidelity', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [{ episodeIndex: 0 }] };
    assert.doesNotThrow(() => validateOutlineChapterCoverage(outline, 'medium', 5));
    assert.doesNotThrow(() => validateOutlineChapterCoverage(outline, 'loose', 5));
  });
});

describe('clip-stage bible injection', () => {
  test('buildClipPrompt injects compressed bible and per-episode prose', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [
        { name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 },
        { name: '林董', role: 'antagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 9, lastChapter: 9 },
      ],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 10, prose: 'helloworld' }];
    const out = buildClipPrompt({
      outline: { title: 't', synopsis: 's', characters: [] },
      episode: { title: 'e1', episodeIndex: 0 },
      clipIndex: 0,
      totalClips: 1,
      clipSummary: 'x',
      bible, chapters, fidelity: 'medium', episodeChapterRange: [1, 1],
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(!out.includes('林董'), 'compressed bible omits out-of-range chars');
    assert.ok(out.includes('## 原文片段'));
    assert.ok(out.includes('helloworld'));
  });

  test('buildClipPrompt without bible or with loose fidelity skips both blocks', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 10, prose: 'helloworld' }];

    const noBible = buildClipPrompt({
      outline: { title: 't' }, episode: {}, clipIndex: 0, totalClips: 1, clipSummary: '',
    });
    assert.ok(!noBible.includes('## 参考小说'));
    assert.ok(!noBible.includes('## 原文片段'));

    const loose = buildClipPrompt({
      outline: { title: 't' }, episode: {}, clipIndex: 0, totalClips: 1, clipSummary: '',
      bible, chapters, fidelity: 'loose', episodeChapterRange: [1, 1],
    });
    assert.ok(loose.includes('## 参考小说'));
    assert.ok(!loose.includes('## 原文片段'));
  });
});

describe('vector store retrieval wiring (search now consumed)', () => {
  test('buildClipPrompt renders retrievedScenes into the prompt', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const out = buildClipPrompt({
      outline: { title: 't' }, episode: { episodeIndex: 3 }, clipIndex: 0, totalClips: 1,
      clipSummary: 'x', retrievedScenes: '【第0集相关片段】关键道具特写',
    });
    assert.ok(out.includes('## 相关历史片段（语义检索）'));
    assert.ok(out.includes('关键道具特写'));
  });

  test('buildClipPrompt shows （无） when no retrieved scenes', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const out = buildClipPrompt({
      outline: { title: 't' }, episode: {}, clipIndex: 0, totalClips: 1, clipSummary: 'x',
    });
    assert.ok(out.includes('## 相关历史片段（语义检索）'));
    assert.ok(out.includes('（无）'));
  });

  test('retrieveRelatedScenes formats hits from other episodes, excludes current', async () => {
    const { retrieveRelatedScenes } = await import('../src/drama-writer.js');
    const { createStore } = await import('../src/vectorstore.js');
    const store = createStore('/tmp/dw-retrieval-test-' + process.pid + '.json');
    store.add('a', '陆衡 推开 大门 龙鳞 戒指 特写', { episodeIndex: 0 });
    store.add('b', '完全 无关 的 风景 描写 田园', { episodeIndex: 1 });
    store.add('c', '陆衡 龙鳞 戒指 再次 出现', { episodeIndex: 5 }); // current ep — must be excluded
    const out = retrieveRelatedScenes(store, '龙鳞 戒指 特写', 5);
    assert.ok(out.includes('第0集相关片段'), 'should surface the related ep-0 scene');
    assert.ok(!out.includes('第5集'), 'must exclude the current episode');
  });

  test('retrieveRelatedScenes returns empty string for an empty / missing store', async () => {
    const { retrieveRelatedScenes } = await import('../src/drama-writer.js');
    const { createStore } = await import('../src/vectorstore.js');
    assert.equal(retrieveRelatedScenes(null, 'q', 0), '');
    const store = createStore('/tmp/dw-retrieval-empty-' + process.pid + '.json');
    assert.equal(retrieveRelatedScenes(store, 'q', 0), '');
  });
});

describe('clip prompt state-context wiring (toPromptContext)', () => {
  test('buildClipPrompt renders stateContext into the 故事状态 section', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const out = buildClipPrompt({
      outline: { title: 't' }, episode: { episodeIndex: 0 }, clipIndex: 0, totalClips: 1,
      clipSummary: 'x', stateContext: '【角色】陆衡：活着',
    });
    assert.ok(out.includes('## 故事状态'), 'state section header present');
    assert.ok(out.includes('【角色】陆衡：活着'), 'state context content injected');
  });

  test('buildClipPrompt shows placeholder when no stateContext', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const out = buildClipPrompt({ outline: { title: 't' }, episode: {}, clipIndex: 0, totalClips: 1, clipSummary: 'x' });
    assert.ok(out.includes('## 故事状态'));
    assert.ok(!out.includes('{{stateContext}}'), 'placeholder token replaced');
  });
});

describe('outline episode/clip count directive', () => {
  test('buildOutlinePrompt omits the count directive when no counts given', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const out = buildOutlinePrompt({ topics: [] }, 'cn', undefined, '', '', '', {});
    assert.ok(!out.includes('集数 / 片段数要求'));
  });

  test('buildOutlinePrompt injects exact episode + clip counts', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const out = buildOutlinePrompt({ topics: [] }, 'cn', undefined, '', '', '', { episodesPerDrama: 30, clipsPerEpisode: 8 });
    assert.ok(out.includes('正好 **30 集**'), 'should pin exact episode count');
    assert.ok(out.includes('episodeIndex 从 0 到 29'));
    assert.ok(out.includes('约 **8 个片段**'), 'should suggest clip count');
  });

  test('buildOutlinePrompt skips count directive under a bible (chapter coverage drives it)', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const out = buildOutlinePrompt({ topics: [] }, 'cn', undefined, '', '', '', {
      episodesPerDrama: 30, clipsPerEpisode: 8, bible: { characters: [], events: [] }, fidelity: 'medium',
    });
    assert.ok(!out.includes('集数 / 片段数要求'));
  });

  test('buildOutlinePrompt count directive is English under lang=en', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const out = buildOutlinePrompt({ topics: [] }, 'en', undefined, '', '', '', { episodesPerDrama: 12 });
    assert.ok(out.includes('Episode / Clip Count Requirement'));
    assert.ok(out.includes('exactly **12 episodes**'));
  });
});
