import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SAMPLE_BIBLE = {
  schemaVersion: 1,
  title: 'Test',
  logline: 'A man returns.',
  characters: [
    { name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 10 },
    { name: '苏晚', role: 'foil', identity: '前妻', motivation: '寻找真相', arc: '怀疑→相信', firstChapter: 2, lastChapter: 10 },
    { name: '林董', role: 'antagonist', identity: '幕后黑手', motivation: '权力', arc: '掌控→失败', firstChapter: 5, lastChapter: 10 },
    { name: '锁定王', role: 'reference-pinned', identity: '指定角色', motivation: 'x', arc: 'y', firstChapter: 99, lastChapter: 99 },
  ],
  events: [
    { eventIndex: 0, summary: '陆衡归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false },
    { eventIndex: 1, summary: '苏晚识破', chapterRange: [3, 4], actors: ['苏晚', '陆衡'], isTurningPoint: false, isReveal: true },
    { eventIndex: 2, summary: '林董出场', chapterRange: [5, 6], actors: ['林董'], isTurningPoint: true, isReveal: false },
  ],
  hooks: [
    { summary: '戒指特写', chapterRange: [1, 1] },
    { summary: '电话铃响', chapterRange: [4, 4] },
  ],
  themes: ['复仇', '身份认同'],
  world: '现代都市豪门',
  ending: '主角揭穿真相，反派败北。',
};

describe('compressBibleForEpisode', () => {
  test('includes only characters whose [first,last] intersects range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [1, 2]);
    const names = out.characters.map(c => c.name);
    assert.ok(names.includes('陆衡'));
    assert.ok(names.includes('苏晚'));
    assert.ok(!names.includes('林董'));
  });

  test('always includes reference-pinned characters regardless of range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [1, 2]);
    const names = out.characters.map(c => c.name);
    assert.ok(names.includes('锁定王'), 'reference-pinned must always appear');
  });

  test('includes only events whose chapterRange intersects range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [3, 5]);
    const summaries = out.events.map(e => e.summary);
    assert.ok(summaries.includes('苏晚识破'));
    assert.ok(summaries.includes('林董出场'));
    assert.ok(!summaries.includes('陆衡归来'));
  });

  test('always includes logline, themes, world, ending', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [99, 100]);
    assert.equal(out.logline, SAMPLE_BIBLE.logline);
    assert.deepEqual(out.themes, SAMPLE_BIBLE.themes);
    assert.equal(out.world, SAMPLE_BIBLE.world);
    assert.equal(out.ending, SAMPLE_BIBLE.ending);
  });

  test('drops hooks not in range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [3, 4]);
    const summaries = out.hooks.map(h => h.summary);
    assert.ok(!summaries.includes('戒指特写'));
    assert.ok(summaries.includes('电话铃响'));
  });
});

describe('selectChapterProse', () => {
  const CHAPTERS = [
    { chapterIndex: 1, title: '一', charCount: 10, prose: 'A'.repeat(10) },
    { chapterIndex: 2, title: '二', charCount: 10, prose: 'B'.repeat(10) },
    { chapterIndex: 3, title: '三', charCount: 10, prose: 'C'.repeat(10) },
  ];

  test('returns concatenated prose when within budget', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const out = selectChapterProse(CHAPTERS, [1, 3], 1000);
    assert.ok(out.includes('AAAAAAAAAA'));
    assert.ok(out.includes('BBBBBBBBBB'));
    assert.ok(out.includes('CCCCCCCCCC'));
    assert.ok(out.includes('章节 1'));
    assert.ok(out.includes('章节 3'));
  });

  test('truncates with head+tail+marker when over budget', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const big = [{ chapterIndex: 1, title: 'big', charCount: 10000, prose: 'X'.repeat(10000) }];
    const out = selectChapterProse(big, [1, 1], 4000);
    assert.ok(out.length <= 4500, `expected <=4500, got ${out.length}`);
    assert.ok(out.includes('省略'));
    assert.match(out, /XX+\s*…\[省略 \d+ 字\]…\s*XX+/s);
  });

  test('returns empty string when range is invalid (no overlap)', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const out = selectChapterProse(CHAPTERS, [99, 100], 4000);
    assert.equal(out, '');
  });

  test('handles single-chapter range', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const out = selectChapterProse(CHAPTERS, [2, 2], 4000);
    assert.ok(out.includes('BBBBBBBBBB'));
    assert.ok(!out.includes('AAAAAAAAAA'));
    assert.ok(!out.includes('CCCCCCCCCC'));
  });
});
