import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSceneTypeRules, listSceneTypes } from '../src/clip-types.js';

describe('getSceneTypeRules', () => {
  it('returns rules for NARRATIVE', () => {
    const rules = getSceneTypeRules('NARRATIVE');
    assert.ok(rules.length > 0, 'should return non-empty string');
    assert.ok(rules.includes('show'), 'should include "show"');
  });

  it('returns rules for DIALOGUE', () => {
    const rules = getSceneTypeRules('DIALOGUE');
    assert.ok(rules.includes('subtext'), 'should include "subtext"');
  });

  it('returns rules for ACTION', () => {
    const rules = getSceneTypeRules('ACTION');
    assert.ok(
      rules.includes('senses') || rules.includes('punchy'),
      'should include "senses" or "punchy"'
    );
  });

  it('returns rules for PSYCHOLOGICAL', () => {
    const rules = getSceneTypeRules('PSYCHOLOGICAL');
    assert.ok(
      rules.includes('cognitive') || rules.includes('internal'),
      'should include "cognitive" or "internal"'
    );
  });

  it('returns rules for ENVIRONMENTAL', () => {
    const rules = getSceneTypeRules('ENVIRONMENTAL');
    assert.ok(rules.includes('setting'), 'should include "setting"');
  });

  it('returns rules for CHOICE', () => {
    const rules = getSceneTypeRules('CHOICE');
    assert.ok(
      rules.includes('tension') || rules.includes('consequential'),
      'should include "tension" or "consequential"'
    );
  });

  it('returns Chinese for cn lang', () => {
    const rules = getSceneTypeRules('NARRATIVE', 'cn');
    assert.ok(/[\u4e00-\u9fff]/.test(rules), 'should contain Chinese characters');
  });

  it('returns empty string for unknown type', () => {
    const rules = getSceneTypeRules('UNKNOWN_TYPE');
    assert.strictEqual(rules, '');
  });
});

describe('listSceneTypes', () => {
  it('returns all 6 types', () => {
    const types = listSceneTypes();
    assert.strictEqual(types.length, 6);
    assert.ok(types.includes('NARRATIVE'));
    assert.ok(types.includes('CHOICE'));
    assert.ok(types.includes('DIALOGUE'));
    assert.ok(types.includes('ACTION'));
    assert.ok(types.includes('PSYCHOLOGICAL'));
    assert.ok(types.includes('ENVIRONMENTAL'));
  });
});
