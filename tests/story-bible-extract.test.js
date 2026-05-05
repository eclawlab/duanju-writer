import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('extractChapterFacts', () => {
  test('parses LLM JSON response into ChapterFacts', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = {
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇' }],
      events: [{ summary: '陆衡归来', actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
      hooks: [{ summary: '戒指特写' }],
      themes: ['复仇'],
      worldDetail: '现代都市',
    };
    const fakeLlm = async () => JSON.stringify(fakeFacts);
    const result = await extractChapterFacts(
      { chapterIndex: 1, title: '归来', prose: '陆衡推开大门。' },
      { llmFn: fakeLlm }
    );
    assert.deepEqual(result.characters[0].name, '陆衡');
    assert.equal(result.events[0].summary, '陆衡归来');
    assert.equal(result.chapterIndex, 1);
  });

  test('strips markdown code fences from LLM response', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    const wrapped = '```json\n' + JSON.stringify(fakeFacts) + '\n```';
    const fakeLlm = async () => wrapped;
    const result = await extractChapterFacts(
      { chapterIndex: 1, title: '', prose: 'hi' },
      { llmFn: fakeLlm }
    );
    assert.deepEqual(result.events, []);
  });

  test('throws on invalid JSON', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeLlm = async () => 'not json at all';
    await assert.rejects(
      extractChapterFacts({ chapterIndex: 1, title: '', prose: 'hi' }, { llmFn: fakeLlm }),
      /JSON|parse/i
    );
  });
});

describe('synthesizeBible', () => {
  test('passes chapter facts array and parses bible response', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const fakeBible = {
      title: 'Test',
      logline: 'logline',
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 2 }],
      events: [{ eventIndex: 0, summary: '归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
      hooks: [],
      themes: ['复仇'],
      world: '现代',
      ending: '主角胜利。',
    };
    const fakeLlm = async () => JSON.stringify(fakeBible);
    const facts = [{ chapterIndex: 1, characters: [], events: [], hooks: [], themes: [], worldDetail: '' }];
    const result = await synthesizeBible(facts, { llmFn: fakeLlm, sourceTitle: 'Test' });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.title, 'Test');
    assert.equal(result.characters[0].name, '陆衡');
  });

  test('throws when bible has zero characters', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const empty = { title: 't', logline: 'l', characters: [], events: [{ eventIndex: 0, summary: 'x', chapterRange: [1,1], actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], world: '', ending: '' };
    const fakeLlm = async () => JSON.stringify(empty);
    await assert.rejects(
      synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 't' }),
      /character/i
    );
  });

  test('throws when bible has zero events', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const empty = { title: 't', logline: 'l', characters: [{ name: 'a', role: 'protagonist', identity: 'x', motivation: 'y', arc: 'z', firstChapter: 1, lastChapter: 1 }], events: [], hooks: [], themes: [], world: '', ending: '' };
    const fakeLlm = async () => JSON.stringify(empty);
    await assert.rejects(
      synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 't' }),
      /event/i
    );
  });
});
