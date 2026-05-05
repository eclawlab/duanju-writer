import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('worker story-extraction phase', () => {
  test('extractStoryArtifacts skips when artifacts exist', async () => {
    const { extractStoryArtifacts } = await import('../src/worker.js');
    const { saveStoryArtifacts } = await import('../src/story-bible.js');
    const dir = mkdtempSync(join(tmpdir(), 'worker-'));
    try {
      saveStoryArtifacts(dir, {
        bible: {
          schemaVersion: 1, title: 't', logline: 'L',
          characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
          events: [{ eventIndex: 0, summary: 's', chapterRange: [1,1], actors: [], isTurningPoint: false, isReveal: false }],
          hooks: [], themes: [], world: 'w', ending: 'e',
        },
        chapters: { schemaVersion: 1, totalChars: 5, chapters: [{ chapterIndex: 1, title: '', charCount: 5, prose: 'hello' }] },
      });
      let calls = 0;
      const fakeLlm = async () => { calls++; return ''; };
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: 'whatever', llmFn: fakeLlm });
      assert.equal(calls, 0, 'no LLM calls expected when artifacts exist');
      assert.ok(result.bible);
      assert.ok(result.chapters);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('extractStoryArtifacts splits, extracts each chapter, synthesizes, persists', async () => {
    const { extractStoryArtifacts } = await import('../src/worker.js');
    const dir = mkdtempSync(join(tmpdir(), 'worker-'));
    try {
      let callIdx = 0;
      const fakeLlm = async (prompt) => {
        callIdx++;
        if (prompt.includes('Per-Chapter Extraction') || prompt.includes('章节编号')) {
          return JSON.stringify({
            characters: [{ name: '陆衡', role: 'protagonist', identity: 'x', motivation: 'y' }],
            events: [{ summary: 'e', actors: [], isTurningPoint: false, isReveal: false }],
            hooks: [],
            themes: [],
            worldDetail: '',
          });
        }
        return JSON.stringify({
          title: 't', logline: 'L',
          characters: [{ name: '陆衡', role: 'protagonist', identity: 'x', motivation: 'y', arc: 'a', firstChapter: 1, lastChapter: 2 }],
          events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
          hooks: [], themes: [], world: 'w', ending: 'end',
        });
      };
      const text = '第一章 一\n内容一。\n第二章 二\n内容二。';
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: text, llmFn: fakeLlm });
      assert.equal(result.chapters.chapters.length, 2);
      assert.equal(result.bible.characters[0].name, '陆衡');
      assert.ok(existsSync(join(dir, 'story', 'bible.json')));
      assert.ok(existsSync(join(dir, 'story', 'chapters.json')));
      assert.ok(callIdx >= 3, '2 chapters + 1 synthesis');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
