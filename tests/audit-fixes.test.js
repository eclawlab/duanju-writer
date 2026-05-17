import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression tests for the codebase audit (2026-05-16). Each test pins a
// confirmed logic bug; they fail on the pre-fix code.

describe('audit: #1 config partial provider merge', () => {
  test('customizing one provider field keeps the default type', async () => {
    const { loadConfigFrom } = await import('../src/config.js');
    const f = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'c.json');
    writeFileSync(f, JSON.stringify({ providers: { claude: { timeout: 600000 } } }));
    const c = loadConfigFrom(f);
    assert.equal(c.providers.claude.timeout, 600000);
    assert.equal(c.providers.claude.type, 'claude-cli'); // was dropped → "Unknown provider type"
    // openai default must survive an unrelated provider override
    assert.equal(c.providers.openai.type, 'openai');
    assert.equal(c.providers.openai.model, 'gpt-4o');
  });
});

describe('audit: #2 loadPromptSection returns full section', () => {
  test('extractChapterFacts prompt includes the schema instructions', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    let captured = '';
    const llmFn = async (prompt) => {
      captured = prompt;
      return JSON.stringify({ characters: [], events: [], hooks: [], themes: [], worldDetail: '' });
    };
    await extractChapterFacts({ chapterIndex: 1, title: 't', prose: 'p' }, { llmFn });
    // Unique string from the body of "## Per-Chapter Extraction" in story-bible.md
    assert.ok(captured.includes('输出严格 JSON'), 'prompt missing schema section');
    assert.ok(captured.includes('worldDetail'), 'prompt missing field schema');
  });
});

describe('audit: #3 modify round-trip does not duplicate genres/tags', () => {
  test('download → upload is idempotent on genres/tags', async () => {
    const { normalizeStory } = await import('../src/downloader.js');
    const { buildRequest } = await import('../src/uploader.js');
    const cfg = { autostoryUrl: 'http://x', aiApiKey: 'k' };
    const drama0 = {
      title: 'T', genre: '都市', genres: ['复仇'], trope: '战神归来', tags: ['打脸'],
      episodes: [{ title: 'E', episodeIndex: 0, scenes: [{ content: 'c' }] }],
    };
    const up1 = JSON.parse(buildRequest(drama0, cfg).options.body);
    const serverBody = { story: { ...up1, episodes: up1.episodes } };
    const dl = normalizeStory(serverBody);
    const up2 = JSON.parse(buildRequest(dl, cfg).options.body);
    assert.deepEqual(up2.genres, up1.genres, 'genres grew on round-trip');
    assert.deepEqual(up2.tags, up1.tags, 'tags grew on round-trip');
    // A second cycle must also be stable.
    const dl2 = normalizeStory({ story: { ...up2, episodes: up2.episodes } });
    const up3 = JSON.parse(buildRequest(dl2, cfg).options.body);
    assert.deepEqual(up3.genres, up1.genres);
    assert.deepEqual(up3.tags, up1.tags);
  });
});

describe('audit: #5 queue busy contract includes extracting', () => {
  test('a job in extracting status counts as busy', async () => {
    const { createJobIn, updateJobIn, hasBusyJobIn } = await import('../src/queue.js');
    const dir = mkdtempSync(join(tmpdir(), 'q-'));
    const jf = join(dir, 'jobs.json');
    const jd = join(dir, 'jobs');
    mkdirSync(jd, { recursive: true });
    const job = createJobIn(jf, jd);
    updateJobIn(jf, job.id, { status: 'extracting' });
    assert.equal(hasBusyJobIn(jf), true);
  });
});

describe('audit: #6 stories lists modify-produced novels', () => {
  test('listPublishedStories includes DATA_DIR/modifications results', async () => {
    const { listPublishedStories } = await import('../src/published.js');
    const root = mkdtempSync(join(tmpdir(), 'pub2-'));
    const jobsDir = join(root, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    const modDir = join(root, 'modifications', 'orig-1-2026-05-16T00-00-00-000Z');
    mkdirSync(modDir, { recursive: true });
    writeFileSync(join(modDir, 'result.json'),
      JSON.stringify({ originalStoryId: 'orig-1', newStoryId: 'mod-99', title: '改后' }));
    const rows = listPublishedStories(jobsDir, join(root, 'modifications'));
    const hit = rows.find((r) => r.storyId === 'mod-99');
    assert.ok(hit, 'modify-produced story not listed');
    assert.equal(hit.title, '改后');
  });
});

describe('audit: #9 parseOutline normalizes episodeIndex to dense 0-based', () => {
  function outline1Based() {
    return {
      title: 'T', synopsis: 'S',
      characters: [
        { name: 'A', role: 'protagonist' },
        { name: 'B', role: 'ally' },
        { name: 'C', role: 'antagonist' },
      ],
      episodes: [
        { episodeIndex: 2, title: 'E2', isEnding: true, ending: '爽爆', clipPlan: [{ summary: 's' }] },
        { episodeIndex: 1, title: 'E1', isEnding: false, ending: null, clipPlan: [{ summary: 's' }] },
      ],
    };
  }
  test('1-based, unsorted outline is renumbered to 0,1 in order', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const r = await parseOutline(JSON.stringify(outline1Based()));
    assert.deepEqual(r.episodes.map((e) => e.episodeIndex), [0, 1]);
    assert.equal(r.episodes[0].title, 'E1');
    assert.equal(r.episodes[1].title, 'E2');
    assert.equal(r.episodes[1].isEnding, true);
  });
});

describe('audit: #10 parsePlan sceneMap keyed by per-episode ordinal', () => {
  test('1-based clipIndex still resolves at position 0', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const plan = parsePlan(JSON.stringify({
      clips: [
        { episodeIndex: 0, clipIndex: 1, events: ['x'], characterChanges: [], itemChanges: [], revealIds: [] },
        { episodeIndex: 0, clipIndex: 2, events: ['y'], characterChanges: [], itemChanges: [], revealIds: [] },
      ],
    }));
    assert.ok(plan.sceneMap['0:0'], 'first clip not reachable at ordinal 0');
    assert.deepEqual(plan.sceneMap['0:0'].events, ['x']);
    assert.deepEqual(plan.sceneMap['0:1'].events, ['y']);
  });
});

describe('audit: #12 mergeRevision honors explicit empty arrays', () => {
  test('explicit characters:[] is kept, absent field falls back', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const drama = {
      title: 'T', characters: [{ name: 'X' }],
      episodes: [{ title: 'E', episodeIndex: 0, scenes: [{ content: 'c' }] }],
    };
    // Model explicitly clears characters but keeps episodes.
    const out = await applyFeedback(drama, 'delete all characters', {
      llmFn: async () => JSON.stringify({ ...drama, characters: [] }),
    });
    assert.deepEqual(out.characters, [], 'explicit empty characters reverted');
    // Absent characters key → fall back to original.
    const out2 = await applyFeedback(drama, 'tweak', {
      llmFn: async () => JSON.stringify({ title: 'T2', episodes: drama.episodes }),
    });
    assert.deepEqual(out2.characters, [{ name: 'X' }]);
  });
});

describe('audit: #13 corrupt history is preserved, not destroyed', () => {
  test('readHistory backs up a corrupt file instead of returning [] silently', async () => {
    const { getHistoryFrom } = await import('../src/history.js');
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    const hf = join(dir, 'history.json');
    writeFileSync(hf, '[{"topic":"keepme"}'); // truncated/corrupt JSON
    const h = getHistoryFrom(hf);
    assert.deepEqual(h, []); // degrades gracefully
    const backups = readdirSync(dir).filter((f) => f.includes('corrupt'));
    assert.equal(backups.length, 1, 'corrupt history not backed up');
    assert.ok(readFileSync(join(dir, backups[0]), 'utf8').includes('keepme'));
  });
});

describe('audit: #11 lock stale-takeover still works after atomic-rename hardening', () => {
  test('a stale lock is taken over and the operation completes', async () => {
    const { createJobIn, listJobsFrom } = await import('../src/queue.js');
    const dir = mkdtempSync(join(tmpdir(), 'lock-'));
    const jf = join(dir, 'jobs.json');
    const jd = join(dir, 'jobs');
    mkdirSync(jd, { recursive: true });
    writeFileSync(jf, '[]');
    const lock = jf + '.lock';
    writeFileSync(lock, String(process.pid));
    const old = new Date(Date.now() - 60_000); // older than LOCK_STALE_MS
    utimesSync(lock, old, old);
    const job = createJobIn(jf, jd); // must take over the stale lock
    assert.ok(job.id);
    assert.equal(listJobsFrom(jf).length, 1);
    assert.equal(existsSync(lock), false, 'lock not released');
  });
});
