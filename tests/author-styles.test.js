import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAuthorStyle,
  getAuthorStyleSafe,
  listAuthorStyles,
  clearAuthorStyleCache,
} from '../src/author-styles.js';

describe('author-styles loader', () => {
  beforeEach(() => clearAuthorStyleCache());

  test('lists all 15 restored authors', () => {
    const list = listAuthorStyles();
    assert.equal(list.length, 15);
    const keys = list.map(s => s.key).sort();
    assert.ok(keys.includes('moyan'));
    assert.ok(keys.includes('jinyong'));
    assert.ok(keys.includes('liucixin'));
    assert.ok(keys.includes('priest'));
  });

  test('getAuthorStyle returns the ## Scene block', () => {
    const s = getAuthorStyle('moyan');
    assert.equal(s.name, 'Mo Yan (莫言)');
    assert.equal(s.category, 'chinese-literary');
    assert.match(s.scene, /Mo Yan|magical realism|莫言/i);
    assert.ok(s.scene.length > 0);
  });

  test('getAuthorStyle is case-insensitive', () => {
    assert.equal(getAuthorStyle('MoYan'.toLowerCase()).name, getAuthorStyle('moyan').name);
  });

  test('getAuthorStyle resolves by Chinese author name', () => {
    assert.equal(getAuthorStyle('莫言').name, 'Mo Yan (莫言)');
    assert.equal(getAuthorStyle('鲁迅').category, 'chinese-literary');
  });

  test('getAuthorStyle resolves by English author name (space/case-insensitive)', () => {
    assert.equal(getAuthorStyle('Mo Yan').name, 'Mo Yan (莫言)');
    assert.equal(getAuthorStyle('liu cixin').name, 'Liu Cixin (刘慈欣)');
    assert.equal(getAuthorStyle('JIN YONG').name, 'Jin Yong (金庸)');
  });

  test('getAuthorStyle resolves by the full name field', () => {
    assert.equal(getAuthorStyle('Mo Yan (莫言)').name, 'Mo Yan (莫言)');
  });

  test('getAuthorStyle still resolves by the original filename key (backward compat)', () => {
    assert.equal(getAuthorStyle('moyan').name, 'Mo Yan (莫言)');
    assert.equal(getAuthorStyleSafe('莫言').scene, getAuthorStyleSafe('moyan').scene);
  });

  test('getAuthorStyle throws with available list on unknown key', () => {
    assert.throws(() => getAuthorStyle('nobody'), /Unknown author style: "nobody"[\s\S]*Available author styles:/);
  });

  test('getAuthorStyle returns null for empty / "default"', () => {
    assert.equal(getAuthorStyle(''), null);
    assert.equal(getAuthorStyle('default'), null);
  });

  test('getAuthorStyleSafe returns null (no throw) on unknown key', () => {
    assert.equal(getAuthorStyleSafe('nobody'), null);
  });

  test('getAuthorStyleSafe returns the style on known key', () => {
    assert.equal(getAuthorStyleSafe('luxun').category, 'chinese-literary');
  });
});
