import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('splitChapters', () => {
  test('splits on Chinese 第N章 headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一章 归来\n陆衡推开大门。\n第二章 重逢\n苏晚抬起头。\n第三章 决裂\n两人对视。';
    const result = splitChapters(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].chapterIndex, 1);
    assert.equal(result[0].title, '归来');
    assert.ok(result[0].prose.includes('陆衡推开大门'));
    assert.equal(result[2].title, '决裂');
  });

  test('splits on Chinese 第N节 headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一节 序\n开篇。\n第二节 遇\n相遇。';
    const result = splitChapters(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, '序');
  });

  test('splits on Western Chapter N headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = 'Chapter 1 Return\nHe came back.\nChapter 2 Reunion\nThey met.';
    const result = splitChapters(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Return');
    assert.equal(result[1].title, 'Reunion');
  });

  test('splits on markdown # Chapter N headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '# Chapter 1 Return\nHe came back.\n# Chapter 2 Reunion\nThey met.';
    const result = splitChapters(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Return');
  });

  test('falls back to ~3000-char windowed chunks when no headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = 'a'.repeat(7500);
    const result = splitChapters(text);
    assert.equal(result.length, 3);
    assert.ok(result[0].prose.length <= 3200);
    assert.ok(result[0].prose.length >= 2800);
    assert.equal(result[0].chapterIndex, 1);
    assert.equal(result[0].title, '');
  });

  test('handles single-chapter input (no heading)', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const result = splitChapters('Short story under 3000 chars.');
    assert.equal(result.length, 1);
    assert.equal(result[0].chapterIndex, 1);
    assert.equal(result[0].prose, 'Short story under 3000 chars.');
  });

  test('throws on empty input', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    assert.throws(() => splitChapters(''), /empty/i);
    assert.throws(() => splitChapters('   \n  \t '), /empty/i);
  });

  test('preserves prose content verbatim across chapters', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一章 标题\n这是第一段。\n这是第二段。\n第二章 标题二\n第二章内容。';
    const result = splitChapters(text);
    assert.ok(result[0].prose.includes('这是第一段'));
    assert.ok(result[0].prose.includes('这是第二段'));
    assert.ok(!result[0].prose.includes('第二章内容'));
    assert.ok(result[1].prose.includes('第二章内容'));
  });
});
