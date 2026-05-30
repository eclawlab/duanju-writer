import { test } from 'node:test';
import assert from 'node:assert/strict';

// generateVariant orchestrates LLM/network calls, so these tests cover the two
// pure control-flow branches that don't require stubbing the whole pipeline:
// the "already uploaded" resume short-circuit, with and without a cached story.

const baseCtx = (over = {}) => ({
  jobId: 'job_x',
  publish: true,
  variationGroupId: 'grp-x',
  computeStoryMetrics: (s) => ({
    clips: (s?.episodes || []).length,
    words: (s?.episodes || []).reduce((n, e) => n + (e.w || 0), 0),
  }),
  log: () => {},
  wlog: () => {},
  saveArtifact: () => {},
  ...over,
});

const V = { key: 'v1', ending: '爽爆', label: '爽爆结局' };

test('generateVariant short-circuits on an already-uploaded variant + folds cached metrics', async () => {
  const { generateVariant } = await import('../src/variant-generator.js');
  const cached = { title: 't', episodes: [{ w: 3 }, { w: 4 }] };
  const loadArtifact = (jobId, name) => {
    if (name === 'upload.v1.json') return { storyId: 'story-123' };
    if (name === 'story.v1.json') return cached;
    return null;
  };
  const r = await generateVariant(V, baseCtx({ loadArtifact }));
  assert.equal(r.storyId, 'story-123');
  assert.equal(r.story, cached);
  assert.equal(r.clips, 2);
  assert.equal(r.words, 7);
});

test('generateVariant resume with missing cached story returns zero metrics, keeps storyId', async () => {
  const { generateVariant } = await import('../src/variant-generator.js');
  const loadArtifact = (jobId, name) => (name === 'upload.v1.json' ? { storyId: 'story-9' } : null);
  const r = await generateVariant(V, baseCtx({ loadArtifact }));
  assert.equal(r.storyId, 'story-9');
  assert.equal(r.story, null);
  assert.equal(r.clips, 0);
  assert.equal(r.words, 0);
});

test('generateVariant does NOT consult the upload artifact when publish=false', async () => {
  const { generateVariant } = await import('../src/variant-generator.js');
  // With publish=false the resume short-circuit is gated off (`publish ?
  // loadArtifact(...) : null`), so the upload.v1.json artifact must never be
  // read. We throw from a sentinel tail-outline load to halt before any real
  // LLM/network call, then assert the upload key was never requested.
  const asked = [];
  const loadArtifact = (jobId, name) => {
    asked.push(name);
    if (name === 'tail-outline.v1.json') throw new Error('halt-before-generation');
    return null;
  };
  await assert.rejects(
    () => generateVariant(V, baseCtx({ publish: false, loadArtifact, chapters: null })),
    /halt-before-generation/,
  );
  assert.ok(!asked.includes('upload.v1.json'), 'must not read the upload artifact when publish=false');
  assert.ok(asked.includes('tail-outline.v1.json'), 'should proceed to tail-outline load');
});
