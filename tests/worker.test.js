import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('worker', () => {
  test('getStatusTransitions covers both story and non-story pipelines', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    // Sanity: every transition references a known status
    const knownStatuses = new Set(['pending', 'extracting', 'collecting', 'writing', 'uploading', 'done']);
    for (const t of transitions) {
      assert.ok(knownStatuses.has(t.from), `unknown from-status ${t.from}`);
      assert.ok(knownStatuses.has(t.to), `unknown to-status ${t.to}`);
    }
  });

  test('getStatusTransitions starts at pending', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    assert.ok(transitions.some(t => t.from === 'pending'));
  });

  test('getStatusTransitions terminates at done', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    assert.ok(transitions.some(t => t.to === 'done'));
  });

  test('getStatusTransitions reaches done from pending via at least one path', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    // BFS from "pending" — every reachable node must be in knownStatuses; "done" must be reachable
    const adj = new Map();
    for (const t of transitions) {
      if (!adj.has(t.from)) adj.set(t.from, []);
      adj.get(t.from).push(t.to);
    }
    const seen = new Set(['pending']);
    const queue = ['pending'];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of (adj.get(cur) || [])) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    assert.ok(seen.has('done'), 'no path from pending to done');
  });

  test('getStatusTransitions includes story-pipeline extracting branch (collecting → extracting)', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    // Real flow: claimNextPending always flips pending→collecting; processJob
    // then promotes collecting→extracting when referenceStory is set, else
    // collecting→writing.
    assert.ok(transitions.some(t => t.from === 'collecting' && t.to === 'extracting'));
    assert.ok(transitions.some(t => t.from === 'collecting' && t.to === 'writing'));
    assert.ok(transitions.some(t => t.from === 'extracting' && t.to === 'writing'));
  });
});

import { computeStoryMetrics } from '../src/worker.js';

test('computeStoryMetrics counts clips and words defensively', () => {
  const story = { episodes: [
    { scenes: [{ content: 'a b c' }, { content: 'd e' }] },
    { scenes: [{ content: 'f' }] },
  ] };
  const m = computeStoryMetrics(story);
  assert.equal(m.clips, 3);
  assert.equal(m.words, 6);
});

test('computeStoryMetrics handles missing episodes/scenes/content', () => {
  assert.deepEqual(computeStoryMetrics(null), { clips: 0, words: 0 });
  assert.deepEqual(computeStoryMetrics({}), { clips: 0, words: 0 });
  assert.deepEqual(computeStoryMetrics({ episodes: [{}, { scenes: [{}] }] }), { clips: 1, words: 0 });
});
