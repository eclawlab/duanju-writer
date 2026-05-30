import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDrama } from '../src/drama-writer.js';

// End-to-end happy-path coverage of the core generation loop with a canned LLM
// (no network). This is the first test that actually EXECUTES generateDrama —
// episode iteration, per-clip generation+parse, episode-level compression,
// branch state, and final story assembly. It is the regression net for the
// integrated pipeline (prior suites only covered builders/parsers in isolation).

// A canned LLM: returns a valid clip JSON for the 'clip' role and a valid
// compressor JSON for the 'compress' role. Branches on the role argument.
function cannedLLM() {
  let clipCounter = 0;
  return async (prompt, role) => {
    if (role === 'compress') {
      return JSON.stringify({
        summary: '压缩摘要', characterActions: ['陆衡行动'], plotProgress: ['推进'], emotionalArc: '紧张',
        stateChanges: { characters: [], items: [] },
      });
    }
    // 'clip' (and 'clip' retry) — a schema-valid non-conclusion clip. The
    // ending episode's missing conclusion is injected by generateDrama itself.
    const idx = clipCounter++;
    return JSON.stringify({
      clipIndex: idx,
      setting: '豪门别墅·夜',
      action: '陆衡推开大门走进客厅',
      dialogue: '[narrator]\n五年了。\n[character:陆衡]\n我回来了。',
      hook: '苏晚的手机响起',
      durationSec: 12,
      isConclusion: false,
      conclusion: null,
    });
  };
}

// A minimal already-parsed outline (the shape worker passes as savedOutline):
// 2 episodes, the last is the ending. clipPlan drives the per-clip loop.
function savedOutline() {
  return {
    title: '战神归来',
    synopsis: '钩子。冲突。',
    trope: '战神归来',
    genre: '都市',
    genres: ['都市'],
    tags: ['复仇'],
    lang: 'cn',
    characters: [
      { name: '陆衡', role: 'protagonist', description: 'x' },
      { name: '苏晚', role: 'ex-wife', description: 'y' },
      { name: '林董', role: 'antagonist', description: 'z' },
    ],
    episodes: [
      { episodeIndex: 0, title: '第1集 归来', isEnding: false, ending: null,
        clipPlan: [{ summary: '陆衡狼狈现身', clipType: 'NARRATIVE', isConclusion: false }] },
      { episodeIndex: 1, title: '第2集 终局', isEnding: true, ending: '爽爆',
        clipPlan: [{ summary: '陆衡身份揭露', clipType: 'NARRATIVE', isConclusion: true }] },
    ],
    characterQuestions: [],
  };
}

test('generateDrama runs the full loop with a canned LLM and assembles a story', async () => {
  const story = await generateDrama({ topics: [], plotHooks: [] }, {
    lang: 'cn',
    style: '战神归来',          // non-'default' so pickStyle (a real LLM call) is skipped
    savedOutline: savedOutline(),
    savedPlan: { clips: [], characters: [], items: [], locations: [], revelations: [] },
    savedSnowflake: null,
    llmFn: cannedLLM(),
  });

  assert.equal(story.title, '战神归来');
  assert.equal(story.episodes.length, 2, 'both episodes generated');
  // Every planned clip became a real scene with composed content.
  for (const ep of story.episodes) {
    assert.ok(ep.scenes.length >= 1, `episode ${ep.episodeIndex} has scenes`);
    for (const sc of ep.scenes) {
      assert.ok(typeof sc.content === 'string' && sc.content.length > 0, 'scene has content');
    }
  }
  // The ending episode's last scene carries a conclusion (injected if the LLM
  // didn't emit one), with the server-canonical enum.
  const lastEp = story.episodes[story.episodes.length - 1];
  const lastScene = lastEp.scenes[lastEp.scenes.length - 1];
  assert.ok(lastScene.conclusion, 'ending episode last scene has a conclusion');
  assert.equal(lastScene.conclusion.type, 'STORY_END');
  assert.equal(lastScene.conclusion.ending, 'GOOD', '爽爆 → GOOD enum');
});
