import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ──────────────────────────────────────────────────────────────────────────────
// Bug #1: extractStoryArtifacts must report isFresh so callers don't double-merge
// reference-pinned entries on resume.
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #1 — extractStoryArtifacts reports isFresh', () => {
  test('isFresh=true on first extraction', async () => {
    const { extractStoryArtifacts } = await import('../src/worker.js');
    const dir = mkdtempSync(join(tmpdir(), 'fresh-'));
    try {
      let i = 0;
      const fakeLlm = async (prompt) => {
        i++;
        if (prompt.includes('章节编号')) {
          return JSON.stringify({ characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm' }], events: [{ summary: 'e', actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], worldDetail: '' });
        }
        return JSON.stringify({ title: 't', logline: 'L', characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }], events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], world: 'w', ending: 'e' });
      };
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: 'hello', llmFn: fakeLlm });
      assert.equal(result.isFresh, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('isFresh=false on resume (artifacts present)', async () => {
    const { extractStoryArtifacts } = await import('../src/worker.js');
    const { saveStoryArtifacts } = await import('../src/story-bible.js');
    const dir = mkdtempSync(join(tmpdir(), 'resume-'));
    try {
      saveStoryArtifacts(dir, {
        bible: { schemaVersion: 1, title: 't', logline: 'L', characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }], events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], world: 'w', ending: 'e' },
        chapters: { schemaVersion: 1, totalChars: 5, chapters: [{ chapterIndex: 1, title: '', charCount: 5, prose: 'hello' }] },
      });
      const fakeLlm = async () => { throw new Error('should not be called on resume'); };
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: 'whatever', llmFn: fakeLlm });
      assert.equal(result.isFresh, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #2: tail outline accepts bible/fidelity and emits chapter-range rule
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #2 — tail outline accepts bible/fidelity', () => {
  test('buildTailOutlinePrompt with bible+fidelity appends bible block + tail-range rule', async () => {
    const { buildTailOutlinePrompt } = await import('../src/drama-writer.js');
    const baseOutline = {
      title: 't', synopsis: 's', genres: [], episodes: [
        { episodeIndex: 0, title: 'e1', clipPlan: [{ summary: 's' }], sourceChapterRange: [1, 2] },
        { episodeIndex: 1, title: 'e2', clipPlan: [{ summary: 's' }], sourceChapterRange: [3, 4] },
      ],
    };
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 5 }],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const out = buildTailOutlinePrompt(baseOutline, 1, '爽爆', null, {
      bible, fidelity: 'tight', totalChapters: 5,
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(out.includes('sourceChapterRange'));
    // Front covered up to ch 2 (the first/front-half episode); tail must cover [3..5]
    assert.ok(out.includes('[3..5]'), `expected [3..5] in tail rule, got: ${out.slice(-300)}`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #3: summarizeSnowflakeForTail reads the actual snowflake fields
// (coreSeed, world.physical.geography), not the long-dead seed/setting.
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #3 — tail summarizer uses real snowflake fields', () => {
  test('drama-writer source no longer reads snowflake.seed or snowflake.setting', async () => {
    const src = readFileSync(new URL('../src/drama-writer.js', import.meta.url), 'utf8');
    assert.ok(!/snowflake\.seed\b/.test(src), 'snowflake.seed reads should be gone');
    assert.ok(!/snowflake\.setting\b/.test(src), 'snowflake.setting reads should be gone');
    assert.ok(/snowflake\.coreSeed\b/.test(src), 'snowflake.coreSeed should be used');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #4: synth-from-bible materials must tolerate missing hooks/themes
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #4 — synth-from-bible tolerates missing hooks/themes', () => {
  test('worker source uses ?? [] guards on bible.hooks and bible.themes', async () => {
    const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.ok(/\(bible\.themes \?\? \[\]\)/.test(src), 'bible.themes should be ?? []-guarded');
    assert.ok(/\(bible\.hooks \?\? \[\]\)/.test(src), 'bible.hooks should be ?? []-guarded');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #5: 'extracting' is a recognized status across queue + worker + bin
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #5 — extracting status is registered', () => {
  test('queue.hasBusyJob includes extracting', async () => {
    const src = readFileSync(new URL('../src/queue.js', import.meta.url), 'utf8');
    assert.ok(/'extracting'/.test(src), 'extracting should appear in queue status predicates');
  });

  test('worker.getStatusTransitions has a pending→extracting edge', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const ts = getStatusTransitions();
    assert.ok(ts.some(t => t.from === 'pending' && t.to === 'extracting'));
  });

  test('bin in-flight filter includes extracting', async () => {
    const src = readFileSync(new URL('../bin/duanju-writer.js', import.meta.url), 'utf8');
    assert.ok(/'extracting'/.test(src), 'extracting should be in bin in-flight filter');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #6: fresh bible invalidates downstream artifacts
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #6 — fresh bible invalidates downstream artifacts', () => {
  test('worker source declares BIBLE_DEPENDENT_ARTIFACTS and invalidates them', async () => {
    const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.ok(/BIBLE_DEPENDENT_ARTIFACTS/.test(src), 'should declare the dependent-artifact list');
    assert.ok(/invalidateBibleDependentArtifacts/.test(src), 'should call the invalidator on fresh extract');
    assert.ok(/'outline\.json'/.test(src), 'outline.json should be in the dependent set');
    assert.ok(/'plan\.json'/.test(src), 'plan.json should be in the dependent set');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #8: bible.world is defensively coerced to a string in buildBibleBlock
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #8 — buildBibleBlock coerces non-string world', () => {
  test('object world does not interpolate [object Object]', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [],
      world: { physical: { geography: 'modern city' }, social: {}, symbolic: {} },
      ending: 'e',
    };
    const out = buildBibleBlock(bible, 'medium');
    assert.ok(!out.includes('[object Object]'), 'must not interpolate [object Object]');
    assert.ok(out.includes('modern city'), 'must serialize the object content via JSON.stringify');
  });

  test('null/undefined world does not crash', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: null, ending: 'e',
    };
    assert.doesNotThrow(() => buildBibleBlock(bible, 'medium'));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #9: createJob writes large referenceStory to a sidecar file rather than
// inlining it in jobs.json (which would bloat every withLock round-trip).
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #9 — referenceStory persisted as sidecar, not inlined', () => {
  test('createJobIn writes reference-story.txt to job dir and stores "sidecar" flag', async () => {
    const { createJobIn } = await import('../src/queue.js');
    const dir = mkdtempSync(join(tmpdir(), 'queue-'));
    const jobsFile = join(dir, 'jobs.json');
    const jobsDir = join(dir, 'jobs');
    try {
      const longStory = 'X'.repeat(50000);
      const job = createJobIn(jobsFile, jobsDir, { referenceStory: longStory, fidelity: 'medium' });
      const sidecar = join(jobsDir, job.id, 'reference-story.txt');
      assert.ok(existsSync(sidecar), 'sidecar file must exist');
      assert.equal(readFileSync(sidecar, 'utf8'), longStory, 'sidecar must contain the original content verbatim');
      // jobs.json must NOT contain the inlined long story
      const jobsRaw = readFileSync(jobsFile, 'utf8');
      assert.ok(!jobsRaw.includes('XXXXXXXXXX'), 'jobs.json should not inline the story content');
      assert.equal(job.options.referenceStory, 'sidecar', 'options must hold the sidecar flag');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('createJobIn with no referenceStory leaves options.referenceStory null', async () => {
    const { createJobIn } = await import('../src/queue.js');
    const dir = mkdtempSync(join(tmpdir(), 'queue-'));
    const jobsFile = join(dir, 'jobs.json');
    const jobsDir = join(dir, 'jobs');
    try {
      const job = createJobIn(jobsFile, jobsDir, {});
      assert.equal(job.options.referenceStory, null);
      assert.ok(!existsSync(join(jobsDir, job.id, 'reference-story.txt')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #10: queue.options snapshot includes episodesPerDrama / clipsPerEpisode
// so daemon-resumed jobs don't silently fall back to config defaults.
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #10 — daemon resume preserves episodes/clips-per-episode', () => {
  test('createJobIn snapshots episodesPerDrama and clipsPerEpisode', async () => {
    const { createJobIn } = await import('../src/queue.js');
    const dir = mkdtempSync(join(tmpdir(), 'queue-'));
    const jobsFile = join(dir, 'jobs.json');
    const jobsDir = join(dir, 'jobs');
    try {
      const job = createJobIn(jobsFile, jobsDir, { episodesPerDrama: 25, clipsPerEpisode: 7 });
      assert.equal(job.options.episodesPerDrama, 25);
      assert.equal(job.options.clipsPerEpisode, 7);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Bug #11: splitChapters logs a warning when falling back to windowed chunks
// (so users know tight-fidelity coverage is over arbitrary windows, not chapters)
// ──────────────────────────────────────────────────────────────────────────────
describe('Bug #11 — splitChapters logs fallback warning', () => {
  test('windowed-chunk fallback emits a log message', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const messages = [];
    const log = (msg) => messages.push(msg);
    splitChapters('a'.repeat(5000), { log });
    assert.ok(messages.some(m => /no chapter headings detected/i.test(m)), 'fallback must log a warning');
  });

  test('detected-headings path does NOT log fallback warning', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const messages = [];
    const log = (msg) => messages.push(msg);
    splitChapters('第一章 一\n内容。\n第二章 二\n内容。', { log });
    assert.ok(!messages.some(m => /no chapter headings detected/i.test(m)));
  });
});
