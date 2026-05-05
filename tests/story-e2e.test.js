import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('story pipeline e2e (mocked LLM)', () => {
  test('full happy path: extracts bible, builds bible block, prompt builders consume it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      const fakeLlm = async (prompt) => {
        if (prompt.includes('章节编号')) {
          return JSON.stringify({
            characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇' }],
            events: [{ summary: '陆衡归来', actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
            hooks: [{ summary: '戒指特写' }],
            themes: ['复仇'],
            worldDetail: '现代都市',
          });
        }
        if (prompt.includes('ChapterFacts JSON')) {
          return JSON.stringify({
            title: '战神归来',
            logline: '陆衡复仇归来',
            characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 2 }],
            events: [{ eventIndex: 0, summary: '陆衡归来', chapterRange: [1, 2], actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
            hooks: [{ summary: '戒指特写', chapterRange: [1, 1] }],
            themes: ['复仇'],
            world: '现代都市',
            ending: '主角胜利。',
          });
        }
        return '{}';
      };

      const { extractStoryArtifacts } = await import('../src/worker.js');
      const text = '第一章 归来\n陆衡推开大门。\n第二章 重逢\n苏晚抬起头。';
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: text, llmFn: fakeLlm });

      assert.ok(existsSync(join(dir, 'story', 'bible.json')));
      assert.ok(existsSync(join(dir, 'story', 'chapters.json')));
      assert.equal(result.bible.characters[0].name, '陆衡');
      assert.equal(result.chapters.chapters.length, 2);

      const { buildBibleBlock, compressBibleForEpisode, buildProseBlock } = await import('../src/story-bible.js');
      const block = buildBibleBlock(result.bible, 'medium');
      assert.ok(block.includes('陆衡'));
      assert.ok(block.includes('Fidelity = medium'));

      const compressed = compressBibleForEpisode(result.bible, [1, 1]);
      assert.equal(compressed.events.length, 1);

      const prose = buildProseBlock(result.chapters.chapters, [1, 1], 'medium', 4000);
      assert.ok(prose.includes('章节 1：归来'));
      assert.ok(prose.includes('陆衡推开大门'));

      const { buildSnowflakePrompt } = await import('../src/snowflake.js');
      const sf = buildSnowflakePrompt({}, 0, [], 'cn', '', '', '', { bible: result.bible, fidelity: 'medium' });
      assert.ok(sf.includes('## 参考小说'));
      assert.ok(sf.includes('陆衡'));

      const { buildOutlinePrompt } = await import('../src/drama-writer.js');
      const ol = buildOutlinePrompt({}, 'cn', '', '', '', '', { bible: result.bible, fidelity: 'tight', totalChapters: 2 });
      assert.ok(ol.includes('## 参考小说'));
      assert.ok(ol.includes('sourceChapterRange'));
      assert.ok(ol.includes('[1..2]'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
