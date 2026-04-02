import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('consistency', () => {
  test('findRepetitiveOpeners detects repeated sentence starters', async () => {
    const { findRepetitiveOpeners } = await import('../src/consistency.js');
    const content = 'She walked to the door. She opened it slowly. She stepped outside. She looked around. He ran away.';
    const issues = findRepetitiveOpeners(content);
    assert.ok(issues.length > 0, 'should find repetitive opener issues');
    assert.ok(issues.some(i => i.includes('She')), 'should mention "She" as the repeated opener');
    assert.ok(issues.some(i => i.includes('4')), 'should report 4 sentences starting with "She"');
  });

  test('findRepetitiveOpeners returns [] for varied openers', async () => {
    const { findRepetitiveOpeners } = await import('../src/consistency.js');
    const content = 'She walked in. He waited. The door creaked. Outside, rain fell. A bird sang.';
    const issues = findRepetitiveOpeners(content);
    assert.deepEqual(issues, []);
  });

  test('findOverusedPhrases detects phrases appearing 3+ times', async () => {
    const { findOverusedPhrases } = await import('../src/consistency.js');
    const content = [
      'Her heart raced as she ran.',
      'She paused, and her heart raced again.',
      'At the sight of him her heart raced wildly.',
    ].join(' ');
    const issues = findOverusedPhrases(content);
    assert.ok(issues.length > 0, 'should find overused phrase issues');
    assert.ok(issues.some(i => i.toLowerCase().includes('heart raced')), 'should mention "heart raced"');
  });

  test('findOverusedPhrases returns [] for unique content', async () => {
    const { findOverusedPhrases } = await import('../src/consistency.js');
    const content = 'The sun rose slowly. Birds began to sing. A cool breeze swept the valley. She smiled at the morning light.';
    const issues = findOverusedPhrases(content);
    assert.deepEqual(issues, []);
  });

  test('checkMotifCooldown flags motifs used too recently', async () => {
    const { checkMotifCooldown } = await import('../src/consistency.js');
    const tracker = { 'her heart raced': 0 };
    const content = 'Her heart raced as she saw him again.';
    const issues = checkMotifCooldown(content, tracker, 1);
    assert.ok(issues.length > 0, 'should flag recently used motif');
    assert.ok(issues.some(i => i.toLowerCase().includes('heart raced')), 'should name the motif phrase');
  });

  test('checkMotifCooldown allows motifs after cooldown has elapsed', async () => {
    const { checkMotifCooldown } = await import('../src/consistency.js');
    const tracker = { 'her heart raced': 0 };
    const content = 'Her heart raced as she saw him again.';
    const issues = checkMotifCooldown(content, tracker, 4);
    assert.deepEqual(issues, []);
  });

  test('updateMotifTracker records 4-5 word phrases from content', async () => {
    const { updateMotifTracker } = await import('../src/consistency.js');
    const tracker = {};
    const content = 'The storm rolled in fast. She felt a cold dread.';
    updateMotifTracker(tracker, content, 2);
    const keys = Object.keys(tracker);
    assert.ok(keys.length > 0, 'should record at least one phrase');
    assert.ok(keys.every(k => {
      const words = k.split(' ');
      return words.length >= 4 && words.length <= 5;
    }), 'all recorded phrases should be 4-5 words');
    assert.ok(Object.values(tracker).every(v => v === 2), 'all phrases should be recorded at sceneIndex 2');
  });

  test('checkConsistency combines all checks and returns issues for repetitive content', async () => {
    const { checkConsistency } = await import('../src/consistency.js');
    const content = 'She walked to the door. She opened it slowly. She stepped outside. She looked around. She smiled.';
    const result = checkConsistency(content, {}, 0);
    assert.ok(result.issues, 'result should have issues array');
    assert.ok(result.issues.length > 0, 'should detect issues in repetitive content');
  });

  test('checkConsistency returns empty issues for clean content', async () => {
    const { checkConsistency } = await import('../src/consistency.js');
    const content = 'The morning arrived quietly. Birds sang outside. A gentle breeze moved the curtains. He stretched and yawned.';
    const result = checkConsistency(content, {}, 0);
    assert.ok(result.issues, 'result should have issues array');
    assert.deepEqual(result.issues, []);
  });

  test('buildRewritePrompt includes issues in the prompt', async () => {
    const { buildRewritePrompt } = await import('../src/consistency.js');
    const content = 'She walked. She opened. She stepped.';
    const issues = ['Repetitive opener: "She" starts 3 sentences'];
    const prompt = buildRewritePrompt(content, issues, 'en');
    assert.ok(prompt.includes('Repetitive opener'), 'prompt should include the issue text');
    assert.ok(prompt.includes('She walked'), 'prompt should include original content');
  });
});
