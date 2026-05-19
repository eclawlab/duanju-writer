import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function seedJob(root, jobId, files) {
  const dir = join(root, jobId);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(data), 'utf8');
  }
}

describe('published', () => {
  test('listPublishedStories collects upload.v*.json across jobs, newest first', async () => {
    const { listPublishedStories } = await import('../src/published.js');
    const root = mkdtempSync(join(tmpdir(), 'pub-'));
    seedJob(root, 'job_20260101000000_aaaa', {
      'upload.v1.json': { storyId: 's-old-1', title: '旧剧', variationLabel: '爽爆结局', ending: '爽爆', variationGroupId: 'g1' },
    });
    seedJob(root, 'job_20260202000000_bbbb', {
      'upload.v1.json': { storyId: 's-new-1', title: '新剧', variationLabel: '爽爆结局' },
      'upload.v2.json': { storyId: 's-new-2', title: '新剧', variationLabel: '苦尽甘来结局' },
    });
    const rows = listPublishedStories(root);
    assert.equal(rows.length, 3);
    // Newest job first.
    assert.equal(rows[0].jobId, 'job_20260202000000_bbbb');
    assert.equal(rows[2].storyId, 's-old-1');
    assert.equal(rows[2].title, '旧剧');
  });

  test('listPublishedStories ignores pending and non-upload artifacts', async () => {
    const { listPublishedStories } = await import('../src/published.js');
    const root = mkdtempSync(join(tmpdir(), 'pub-'));
    seedJob(root, 'job_1', {
      'upload.v1.pending.json': { storyId: 's-pending' },
      'outline.json': { storyId: 'not-a-story' },
      'upload.v1.json': { storyId: 's-real', title: 'T' },
    });
    const rows = listPublishedStories(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].storyId, 's-real');
  });

  test('listPublishedStories skips records without a storyId and corrupt JSON', async () => {
    const { listPublishedStories } = await import('../src/published.js');
    const root = mkdtempSync(join(tmpdir(), 'pub-'));
    const dir = join(root, 'job_x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'upload.v1.json'), '{ broken', 'utf8');
    writeFileSync(join(dir, 'upload.v2.json'), JSON.stringify({ title: 'no id' }), 'utf8');
    writeFileSync(join(dir, 'upload.v3.json'), JSON.stringify({ storyId: 'ok' }), 'utf8');
    const rows = listPublishedStories(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].storyId, 'ok');
  });

  test('listPublishedStories returns [] for a missing directory', async () => {
    const { listPublishedStories } = await import('../src/published.js');
    assert.deepEqual(listPublishedStories(join(tmpdir(), 'does-not-exist-xyz')), []);
  });

  test('filterPublishedStories matches title, storyId, jobId case-insensitively', async () => {
    const { filterPublishedStories } = await import('../src/published.js');
    const rows = [
      { title: '战神归来', storyId: 'abc-123', jobId: 'job_1' },
      { title: '甜宠日常', storyId: 'def-456', jobId: 'job_2' },
    ];
    assert.equal(filterPublishedStories(rows, '战神').length, 1);
    assert.equal(filterPublishedStories(rows, 'DEF').length, 1);
    assert.equal(filterPublishedStories(rows, 'job_2').length, 1);
    assert.equal(filterPublishedStories(rows, '').length, 2);
    assert.equal(filterPublishedStories(rows, 'zzz').length, 0);
  });
});
