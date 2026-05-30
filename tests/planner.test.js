import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('planner bible injection', () => {
  test('buildPlanPrompt injects bible block when bible provided', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [
        { name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 5 },
        { name: '林董', role: 'antagonist', identity: 'i2', motivation: 'm2', arc: 'a2', firstChapter: 9, lastChapter: 9 },
      ],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 5, prose: 'hello' }];
    const out = buildPlanPrompt({ episodes: [] }, 'cn', '', '', '', {
      bible, chapters, fidelity: 'medium', aggregateChapterRange: [1, 1],
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(out.includes('林董'), 'plan stage gets full bible (no compression)');
    assert.ok(out.includes('## 原文片段'));
    assert.ok(out.includes('hello'));
  });

  test('buildPlanPrompt omits prose block on loose fidelity', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 5, prose: 'hello' }];
    const out = buildPlanPrompt({ episodes: [] }, 'cn', '', '', '', {
      bible, chapters, fidelity: 'loose', aggregateChapterRange: [1, 1],
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(!out.includes('## 原文片段'));
  });
});

describe('planner', () => {
  test('buildPlanPrompt inserts outline into template', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = {
      title: 'Test Story',
      episodes: [{ title: 'Episode 1', clipPlan: [{ summary: 'Scene 1' }] }],
    };
    const prompt = buildPlanPrompt(outline, 'en');
    assert.ok(prompt.includes('Test Story'), 'prompt should include outline title');
    assert.ok(prompt.includes('Scene 1'), 'prompt should include scene summary');
  });

  test('buildPlanPrompt uses CN template for cn lang', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: 'Test', episodes: [] };
    const prompt = buildPlanPrompt(outline, 'cn');
    assert.ok(prompt.includes('短剧叙事规划师'), 'CN prompt should include Chinese header text');
  });

  test('parsePlan validates required structure', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const plan = {
      characters: [{ name: 'Alice', status: 'alive', location: 'Forest', knowledge: [], emotional: 'calm' }],
      items: [],
      locations: [{ name: 'Forest', status: 'accessible' }],
      revelations: [],
      clips: [
        { clipIndex: 0, events: ['Alice enters the forest'], threads: [], characterChanges: [], itemChanges: [], revealIds: [], pacing: 'slow' },
      ],
    };
    const result = parsePlan(JSON.stringify(plan));
    assert.ok(Array.isArray(result.clips), 'result should have clips array');
    assert.equal(result.clips.length, 1, 'result should have 1 scene');
    assert.equal(result.clips[0].events[0], 'Alice enters the forest');
  });

  test('parsePlan throws on missing clips', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const plan = { characters: [], items: [], locations: [], revelations: [] };
    assert.throws(
      () => parsePlan(JSON.stringify(plan)),
      /clips/i,
      'should throw with message mentioning clips'
    );
  });

  test('parsePlan throws on scene without events', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const plan = {
      characters: [],
      items: [],
      locations: [],
      revelations: [],
      clips: [{ clipIndex: 0, events: [], threads: [], characterChanges: [], itemChanges: [], revealIds: [], pacing: 'slow' }],
    };
    assert.throws(
      () => parsePlan(JSON.stringify(plan)),
      /events/i,
      'should throw with message mentioning events'
    );
  });

  test('parsePlan strips code fences', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const plan = {
      characters: [],
      items: [],
      locations: [],
      revelations: [],
      clips: [{ clipIndex: 0, events: ['Something happens'], threads: [], characterChanges: [], itemChanges: [], revealIds: [], pacing: 'fast' }],
    };
    const raw = '```json\n' + JSON.stringify(plan) + '\n```';
    const result = parsePlan(raw);
    assert.ok(Array.isArray(result.clips), 'result should have clips array after stripping code fences');
    assert.equal(result.clips[0].events[0], 'Something happens');
  });

  test('initStateFromPlan creates state from plan data', async () => {
    const { initStateFromPlan } = await import('../src/planner.js');
    const plan = {
      characters: [
        { name: 'Alice', status: 'alive', location: 'Forest', knowledge: ['magic exists'], emotional: 'curious' },
        { name: 'Bob', status: 'alive', location: 'Village', knowledge: [], emotional: 'anxious' },
      ],
      items: [
        { name: 'Magic Sword', status: 'active', holder: 'Alice', location: null },
        { name: 'Map', status: 'active', holder: null, location: 'Village' },
      ],
      locations: [
        { name: 'Forest', status: 'accessible' },
        { name: 'Village', status: 'accessible' },
      ],
      revelations: [
        { id: 'rev_1', info: 'Alice is the chosen one', visibility: 'hidden', revealInClip: 2 },
        { id: 'rev_2', info: 'The king is corrupt', visibility: 'public', revealInClip: null },
      ],
      clips: [],
    };
    const state = initStateFromPlan(plan);
    assert.ok(state.characters['Alice'], 'state should have Alice');
    assert.ok(state.characters['Bob'], 'state should have Bob');
    assert.equal(state.characters['Alice'].location, 'Forest');
    assert.equal(state.characters['Alice'].emotional, 'curious');
    assert.ok(state.items['Magic Sword'], 'state should have Magic Sword');
    assert.ok(state.items['Map'], 'state should have Map');
    assert.equal(state.items['Magic Sword'].holder, 'Alice');
    assert.ok(state.locations['Forest'], 'state should have Forest location');
    assert.ok(state.locations['Village'], 'state should have Village location');
    assert.equal(state.revelations.length, 2, 'state should have 2 revelations');
    assert.ok(state.revelations.some(r => r.id === 'rev_1'), 'state should have rev_1');
    assert.ok(state.revelations.some(r => r.id === 'rev_2'), 'state should have rev_2');
  });
});

test('sceneKey composes episodeIndex:ordinal', async () => {
  const { sceneKey } = await import('../src/planner.js');
  assert.equal(sceneKey(3, 0), '3:0');
  assert.equal(sceneKey(0, 5), '0:5');
});
