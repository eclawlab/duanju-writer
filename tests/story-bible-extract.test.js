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

  test('always-on JSON guard is the FIRST content of the prompt', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    let receivedPrompt = '';
    const fakeLlm = async (prompt) => { receivedPrompt = prompt; return JSON.stringify(fakeFacts); };
    await extractChapterFacts(
      { chapterIndex: 1, title: '', prose: 'hi' },
      { llmFn: fakeLlm }
    );
    assert.ok(receivedPrompt.startsWith('【系统指令'), 'guard must lead the prompt, not be buried mid-prompt');
    assert.ok(receivedPrompt.includes('不要提问'), 'guard must forbid asking questions');
    assert.ok(receivedPrompt.includes('JSON.parse'), 'guard must mention machine-parsing context');
  });

  test('strict: true adds a STRICT RETRY hint after the always-on guard', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    let receivedPrompt = '';
    const fakeLlm = async (prompt) => { receivedPrompt = prompt; return JSON.stringify(fakeFacts); };
    await extractChapterFacts(
      { chapterIndex: 1, title: '', prose: 'hi' },
      { llmFn: fakeLlm, strict: true }
    );
    assert.ok(receivedPrompt.includes('严格重试'), 'strict retry marker should be in the prompt');
    assert.ok(
      !receivedPrompt.includes('使用空数组'),
      'strict hint must NOT tell the LLM to fall back to empty arrays — that just escalated the problem to synthesis',
    );
  });

  test('default (strict: false) does NOT include the strict-retry hint', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    let receivedPrompt = '';
    const fakeLlm = async (prompt) => { receivedPrompt = prompt; return JSON.stringify(fakeFacts); };
    await extractChapterFacts(
      { chapterIndex: 1, title: '', prose: 'hi' },
      { llmFn: fakeLlm }
    );
    assert.ok(!receivedPrompt.includes('严格重试'), 'first-try prompt should not include retry hint');
  });

  test('throws schema mismatch when LLM uses wrong field names (e.g. beats instead of events)', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const wrongShape = { chapter: 1, title: '归来', beats: [{ id: 1, summary: 'x' }] };
    const fakeLlm = async () => JSON.stringify(wrongShape);
    await assert.rejects(
      extractChapterFacts({ chapterIndex: 1, title: '', prose: 'hi' }, { llmFn: fakeLlm }),
      /schema mismatch.*characters.*events/i,
    );
  });

  test('schema mismatch error names the missing fields and shows seen keys', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const wrongShape = { chapter_number: 2, key_events: ['x'], characters: ['just-a-string'] }; // characters present but events[] missing
    const fakeLlm = async () => JSON.stringify(wrongShape);
    try {
      await extractChapterFacts({ chapterIndex: 1, title: '', prose: 'hi' }, { llmFn: fakeLlm });
      assert.fail('expected throw');
    } catch (err) {
      assert.match(err.message, /events\[\]/);
      assert.match(err.message, /chapter_number/);
    }
  });

  test('JSON_GUARD names common wrong-schema field names so the LLM avoids them', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const goodFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    let receivedPrompt = '';
    const fakeLlm = async (prompt) => { receivedPrompt = prompt; return JSON.stringify(goodFacts); };
    await extractChapterFacts({ chapterIndex: 1, title: '', prose: 'hi' }, { llmFn: fakeLlm });
    assert.ok(receivedPrompt.includes('beats'), 'guard must call out beats as a known wrong field');
    assert.ok(receivedPrompt.includes('key_events') || receivedPrompt.includes('plotPoints'), 'guard must call out wrong inner-event field names');
  });

  test('extracts JSON when LLM prefixes prose ("This input..." / "I\'ll output...")', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    const prefixed = `I'll output the JSON now.\n\n${JSON.stringify(fakeFacts)}\n\nDone.`;
    const fakeLlm = async () => prefixed;
    const result = await extractChapterFacts(
      { chapterIndex: 7, title: '', prose: 'hi' },
      { llmFn: fakeLlm }
    );
    assert.equal(result.chapterIndex, 7);
    assert.deepEqual(result.events, []);
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

  test('strict: true adds the STRICT RETRY hint to the synthesis prompt', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const bible = {
      title: 'T', logline: 'l',
      characters: [{ name: 'a', role: 'protagonist', identity: 'x', motivation: 'y', arc: 'z', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: '', ending: '',
    };
    let receivedPrompt = '';
    const fakeLlm = async (prompt) => { receivedPrompt = prompt; return JSON.stringify(bible); };
    await synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 't', strict: true });
    assert.ok(receivedPrompt.startsWith('【系统指令'), 'guard must lead the synthesis prompt too');
    assert.ok(receivedPrompt.includes('严格重试'), 'strict-retry hint must be present when strict: true');
  });

  test('throws schema mismatch when synthesis returns wrong shape (e.g. only title)', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const wrongShape = { title: '穿越将军的杂货铺' }; // tiny stub like the real failure
    const fakeLlm = async () => JSON.stringify(wrongShape);
    await assert.rejects(
      synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 't' }),
      /schema mismatch.*characters.*events/i,
    );
  });

  test('extracts JSON when LLM wraps the bible in prose', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const bible = {
      title: 'Test',
      logline: 'logline',
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 2 }],
      events: [{ eventIndex: 0, summary: '归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
      hooks: [],
      themes: ['复仇'],
      world: '现代',
      ending: '主角胜利。',
    };
    const prefixed = `This input is narrative. Output:\n\n${JSON.stringify(bible)}`;
    const fakeLlm = async () => prefixed;
    const result = await synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 'Test' });
    assert.equal(result.title, 'Test');
    assert.equal(result.characters[0].name, '陆衡');
  });
});
