import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDrama } from '../src/drama-writer.js';

// Regression for Fix #2: generateDrama referenced an undeclared `llmFn` at three
// sites (clip ctx, clip-retry call, per-episode compressClips), and generateClip
// called callLLM directly instead of ctx.llmFn. The injected llmFn therefore
// never reached clip generation, the retry path threw "llmFn is not defined" and
// fell to a hardcoded fallback clip, and per-episode compression always failed.
//
// This test proves the injected llmFn actually drives BOTH clip generation and
// compression by returning sentinel content that only an injected fn could
// produce — the old fallback clip content (场景 · 时间 · 氛围 / 动作描述) would
// otherwise appear.

const SENTINEL_DIALOGUE = '[narrator]\n这是注入LLM生成的内容标记XYZ。';

function cannedLLM() {
  const calls = { clip: 0, compress: 0 };
  const fn = async (prompt, role) => {
    if (role === 'compress') {
      calls.compress++;
      return JSON.stringify({
        summary: '压缩摘要', characterActions: [], plotProgress: [], emotionalArc: '紧张',
        stateChanges: { characters: [], items: [] },
      });
    }
    calls.clip++;
    return JSON.stringify({
      clipIndex: 0,
      setting: '豪门别墅·夜',
      action: '陆衡推开大门走进客厅',
      dialogue: SENTINEL_DIALOGUE,
      hook: '苏晚的手机响起',
      durationSec: 12,
      isConclusion: false,
      conclusion: null,
    });
  };
  fn.calls = calls;
  return fn;
}

function savedOutline() {
  return {
    title: '战神归来', synopsis: '钩子。冲突。', trope: '战神归来', genre: '都市',
    genres: ['都市'], tags: ['复仇'], lang: 'cn',
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

test('generateDrama routes the injected llmFn through clip generation (not fallback)', async () => {
  const llm = cannedLLM();
  const story = await generateDrama({ topics: [], plotHooks: [] }, {
    lang: 'cn',
    style: '战神归来',
    savedOutline: savedOutline(),
    savedPlan: { clips: [], characters: [], items: [], locations: [], revelations: [] },
    savedSnowflake: null,
    llmFn: llm,
  });

  // The injected clip content must appear — proving generateClip used ctx.llmFn,
  // not callLLM, and did not fall through to buildFallbackClip.
  const allContent = story.episodes.flatMap(ep => ep.scenes.map(s => s.content)).join('\n');
  assert.match(allContent, /注入LLM生成的内容标记XYZ/, 'injected llmFn output must reach clip content');
  assert.ok(llm.calls.clip > 0, 'injected llmFn must be called for clips');
});

test('generateDrama routes the injected llmFn through per-episode compression', async () => {
  const llm = cannedLLM();
  await generateDrama({ topics: [], plotHooks: [] }, {
    lang: 'cn',
    style: '战神归来',
    savedOutline: savedOutline(),
    savedPlan: { clips: [], characters: [], items: [], locations: [], revelations: [] },
    savedSnowflake: null,
    llmFn: llm,
  });
  // compressClips(episode.scenes, lang, mode, llmFn) must use the injected fn.
  // Pre-fix, the bare `llmFn` reference threw and compression silently fell back.
  assert.ok(llm.calls.compress > 0, 'injected llmFn must be called for compression');
});
