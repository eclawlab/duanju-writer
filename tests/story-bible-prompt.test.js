import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SAMPLE_BIBLE = {
  schemaVersion: 1,
  title: '战神归来',
  logline: '陆衡五年后归来复仇。',
  characters: [
    { name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 10 },
  ],
  events: [
    { eventIndex: 0, summary: '陆衡归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false },
  ],
  hooks: [{ summary: '戒指特写', chapterRange: [1, 1] }],
  themes: ['复仇'],
  world: '现代都市',
  ending: '主角胜利。',
};

describe('buildBibleBlock', () => {
  test('renders heading + logline + chars + events + themes + world + ending', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const out = buildBibleBlock(SAMPLE_BIBLE, 'medium');
    assert.match(out, /## 参考小说/);
    assert.ok(out.includes('陆衡五年后归来复仇'));
    assert.ok(out.includes('陆衡'));
    assert.ok(out.includes('陆衡归来'));
    assert.ok(out.includes('复仇'));
    assert.ok(out.includes('现代都市'));
    assert.ok(out.includes('主角胜利'));
  });

  test('tight fidelity emits strict instruction', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const out = buildBibleBlock(SAMPLE_BIBLE, 'tight');
    assert.ok(out.includes('tight'));
    assert.ok(out.includes('禁止改名'));
  });

  test('loose fidelity emits inspiration-only instruction', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const out = buildBibleBlock(SAMPLE_BIBLE, 'loose');
    assert.ok(out.includes('loose'));
    assert.ok(out.includes('灵感'));
  });

  test('throws on unknown fidelity', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    assert.throws(() => buildBibleBlock(SAMPLE_BIBLE, 'extreme'), /fidelity/i);
  });
});

describe('buildProseBlock', () => {
  const CHAPTERS = [
    { chapterIndex: 1, title: '归来', charCount: 30, prose: '陆衡推开大门，浑身湿透站在前妻苏晚面前。' },
  ];

  test('renders prose block with chapter headers', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    const out = buildProseBlock(CHAPTERS, [1, 1], 'medium', 4000);
    assert.match(out, /## 原文片段/);
    assert.ok(out.includes('章节 1：归来'));
    assert.ok(out.includes('陆衡推开大门'));
    assert.ok(out.includes('不得逐字抄录'));
  });

  test('returns empty string for loose fidelity', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    const out = buildProseBlock(CHAPTERS, [1, 1], 'loose', 4000);
    assert.equal(out, '');
  });

  test('returns empty string when range has no overlap', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    const out = buildProseBlock(CHAPTERS, [99, 100], 'medium', 4000);
    assert.equal(out, '');
  });

  test('returns empty string when range is null/undefined', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    assert.equal(buildProseBlock(CHAPTERS, null, 'medium', 4000), '');
    assert.equal(buildProseBlock(CHAPTERS, undefined, 'medium', 4000), '');
  });
});
