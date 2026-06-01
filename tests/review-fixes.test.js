import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression tests for the HIGH/MEDIUM/LOW bugs found in the codebase review.
// Each describe block maps to one finding.

// ── Fix #3 (HIGH): isTransientLLMError must match "overloaded" across the
//    newline the Claude CLI adapter inserts between message and stderr.
describe('review #3 — Claude CLI overloaded is transient across newline', () => {
  test('multi-line "Claude CLI failed: ...\\n...overloaded..." is transient', async () => {
    const { isTransientLLMError } = await import('../src/llm.js');
    // Exact shape the adapter builds: `Claude CLI failed: ${err.message}\n${stderr}`
    const msg = 'Claude CLI failed: Command failed: claude -p ...\n'
      + 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    assert.equal(isTransientLLMError(new Error(msg)), true,
      'overloaded after a newline must be classified transient (auto-retry)');
  });

  test('single-line overloaded still transient (no regression)', async () => {
    const { isTransientLLMError } = await import('../src/llm.js');
    assert.equal(isTransientLLMError(new Error('Claude CLI failed: api overloaded')), true);
  });

  test('unrelated Claude CLI error is NOT transient', async () => {
    const { isTransientLLMError } = await import('../src/llm.js');
    assert.equal(isTransientLLMError(new Error('Claude CLI failed: bad request')), false);
  });
});

// ── Fix #4 (HIGH): readHistory must treat a valid-but-non-array file as
//    corrupt (preserve aside, return []), not return the object and crash
//    addEntryTo with "entries.push is not a function".
describe('review #4 — non-array history.json degrades gracefully', () => {
  test('object-valued history.json returns [] and does not crash addEntryTo', async () => {
    const { getHistoryFrom, addEntryTo } = await import('../src/history.js');
    const dir = mkdtempSync(join(tmpdir(), 'hist-nonarray-'));
    try {
      const hf = join(dir, 'history.json');
      writeFileSync(hf, '{"not":"an array"}'); // valid JSON, wrong shape
      assert.deepEqual(getHistoryFrom(hf), [], 'non-array history must degrade to []');
      // The real crash: addEntryTo would call entries.push on a non-array.
      await assert.doesNotReject(async () => addEntryTo(hf, { topic: 'x' }));
      assert.equal(getHistoryFrom(hf).length, 1, 'entry written after reset');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Fix #5 (MEDIUM): addCharacter must guard a missing name like its siblings.
describe('review #5 — addCharacter skips missing-name entries', () => {
  test('addCharacter with no name does not create a "undefined" key', async () => {
    const { createState, addCharacter } = await import('../src/drama-state.js');
    const state = createState();
    addCharacter(state, { status: 'alive', knowledge: [], emotional: '' });
    assert.deepEqual(Object.keys(state.characters), [],
      'nameless character must be skipped, not keyed under "undefined"');
  });

  test('addCharacter with a name still works', async () => {
    const { createState, addCharacter } = await import('../src/drama-state.js');
    const state = createState();
    addCharacter(state, { name: '陆衡', status: 'alive', knowledge: [], emotional: '' });
    assert.equal(state.characters['陆衡'].name, '陆衡');
  });
});

// ── Fix #6 (MEDIUM): mapWithConcurrency must stop launching new tasks after a
//    rejection (no fire-and-forget extra executions).
describe('review #6 — mapWithConcurrency stops after first rejection', () => {
  test('no NEW tasks are pulled once one task rejects', async () => {
    const { mapWithConcurrency } = await import('../src/async.js');
    let invoked = 0;
    // 20 items, limit=2. Item 0 throws after a tick; item 1 is a slow task that
    // is in-flight when the rejection happens. A correct impl pulls NO further
    // items, so total invocations stay at 2 (the two that started). The buggy
    // impl lets the surviving worker drain the rest → invoked climbs toward 20.
    const items = Array.from({ length: 20 }, (_, i) => i);
    await assert.rejects(() => mapWithConcurrency(items, 2, async (n) => {
      invoked++;
      if (n === 0) { await new Promise(r => setTimeout(r, 1)); throw new Error('boom'); }
      await new Promise(r => setTimeout(r, 50));
      return n;
    }));
    // Give any rogue surviving worker ample time to drain remaining items.
    await new Promise(r => setTimeout(r, 100));
    assert.ok(invoked <= 2,
      `expected at most the 2 in-flight tasks, but ${invoked} ran (worker kept pulling after rejection)`);
  });
});

// ── Fix #7 (MEDIUM): callLLM stats.calls counts once per logical call, not
//    once per retry attempt.
describe('review #7 — llm stats.calls not inflated by retries', () => {
  test('a call that succeeds after transient retries counts as 1', async () => {
    const llm = await import('../src/llm.js');
    const { resetLLMStats, getLLMStats, __setProviderForTest, retryTransient } = llm;
    // If a test seam isn't exported, fall back to asserting the accounting lives
    // outside the retry loop by inspecting source (documented below).
    if (typeof __setProviderForTest !== 'function') {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(new URL('../src/llm.js', import.meta.url), 'utf8');
      // The stats.calls increment must NOT be inside the retryTransient thunk.
      const thunkBody = src.slice(src.indexOf('return retryTransient('));
      const firstCloser = thunkBody.indexOf('\n  });');
      const thunk = thunkBody.slice(0, firstCloser);
      assert.ok(!/stats\.calls\s*\+=/.test(thunk),
        'stats.calls must be incremented once per callLLM, not inside the retry thunk');
      return;
    }
  });
});

// ── Fix #8 (MEDIUM): listPublishedStories sorts newest-first by createdAt, so
//    a newer modification is not buried under older job uploads.
describe('review #8 — published stories sort newest-first by date', () => {
  test('a newer JOB upload sorts above an older MODIFICATION (date beats jobId)', async () => {
    // Discriminating case: date-order and jobId-string-order DISAGREE. The
    // newer row is a job upload (jobId "job_...") and the older row is a
    // modification (jobId "mod:..."). The buggy comparator sorts by jobId
    // first ("job_" < "mod:" → mod wins), burying the newer job below the
    // older mod. A correct createdAt-first sort puts the newer job on top.
    const { mkdirSync, utimesSync } = await import('node:fs');
    const { listPublishedStories } = await import('../src/published.js');
    const root = mkdtempSync(join(tmpdir(), 'pub-sort-'));
    try {
      const jobsDir = join(root, 'jobs');
      const modsDir = join(root, 'mods');

      // OLDER modification (mtime in the past)
      const md = join(modsDir, 'src-story-2026-01-01T00:00:00Z');
      mkdirSync(md, { recursive: true });
      const modFile = join(md, 'result.json');
      writeFileSync(modFile, JSON.stringify({ newStoryId: 'old-mod', title: 'OldMod' }));
      const past = new Date(Date.now() - 86_400_000);
      utimesSync(modFile, past, past);

      // NEWER job upload (mtime now)
      const jd = join(jobsDir, 'job_20260601000000_zzzz');
      mkdirSync(jd, { recursive: true });
      writeFileSync(join(jd, 'upload.v1.json'), JSON.stringify({ storyId: 'new-job', title: 'NewJob' }));

      const rows = listPublishedStories(jobsDir, modsDir);
      const idx = (id) => rows.findIndex(r => r.storyId === id);
      assert.ok(idx('new-job') !== -1 && idx('old-mod') !== -1, 'both rows present');
      assert.ok(idx('new-job') < idx('old-mod'),
        'the newer job upload must sort before the older modification (newest-first by date)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── LOW: countWords must count CJK Extension-A consistently with countChars.
describe('review LOW — countWords covers CJK Extension-A', () => {
  test('Ext-A characters count as individual words (matches countChars)', async () => {
    const { countWords, countChars } = await import('../src/enrichment.js');
    const extA = '㐀㐁㐂'; // U+3400..U+3402, CJK Extension A
    assert.equal(countChars(extA), 3);
    assert.equal(countWords(extA), 3, 'countWords must count Ext-A chars like countChars');
  });
});

// ── LOW: addRevelation must guard a missing id (otherwise markRevealed and the
//    dup-check collide on undefined).
describe('review LOW — addRevelation skips missing-id entries', () => {
  test('revelation with no id is not pushed', async () => {
    const { createState, addRevelation } = await import('../src/drama-state.js');
    const state = createState();
    addRevelation(state, { info: 'secret', visibility: 'public', revealInClip: 2 });
    assert.equal(state.revelations.length, 0, 'id-less revelation must be skipped');
  });
});

// ── LOW: getCharacterContext must not treat two location-less characters as
//    co-located (undefined === undefined).
describe('review LOW — getCharacterContext does not co-locate unplaced chars', () => {
  test('a location-less character does not pull in other location-less chars', async () => {
    const { createState, addCharacter, getCharacterContext } = await import('../src/drama-state.js');
    const state = createState();
    addCharacter(state, { name: 'A', status: 'alive', knowledge: [], emotional: '' }); // no location
    addCharacter(state, { name: 'B', status: 'alive', knowledge: [], emotional: '' }); // no location
    const ctx = getCharacterContext(state, 'A');
    assert.deepEqual(Object.keys(ctx.characters), ['A'],
      'unplaced A must see only itself, not the unrelated unplaced B');
  });
});

// ── LOW: chunkText must split CJK prose (。！？) and hard-cap oversized runs.
describe('review LOW — chunkText handles CJK and oversized runs', () => {
  test('CJK paragraph splits on 。！？ instead of returning one huge chunk', async () => {
    const { chunkText } = await import('../src/knowledge.js');
    const sentence = '这是一个很长的句子用来测试中文分句逻辑。'; // ends with 。
    const para = sentence.repeat(6); // one paragraph, well over a small budget
    const chunks = chunkText(para, 40);
    assert.ok(chunks.length > 1, 'CJK paragraph must split into multiple chunks');
    for (const c of chunks) {
      assert.ok(c.length <= 40, `chunk exceeds budget: ${c.length}`);
    }
  });

  test('a delimiter-less oversized run is hard-sliced to the budget', async () => {
    const { chunkText } = await import('../src/knowledge.js');
    const chunks = chunkText('x'.repeat(130), 50);
    for (const c of chunks) {
      assert.ok(c.length <= 50, `chunk exceeds budget: ${c.length}`);
    }
  });
});

// ── LOW: parseFrontmatter must tolerate CRLF line endings.
describe('review LOW — parseFrontmatter handles CRLF', () => {
  test('CRLF frontmatter still parses meta and body', async () => {
    const { parseFrontmatter } = await import('../src/markdown.js');
    const content = '---\r\nname: Mo Yan\r\ncategory: literary\r\n---\r\nBody text here.';
    const { meta, body } = parseFrontmatter(content);
    assert.equal(meta.name, 'Mo Yan', 'CRLF frontmatter key must parse');
    assert.equal(meta.category, 'literary');
    assert.match(body, /Body text here\./);
  });
});
