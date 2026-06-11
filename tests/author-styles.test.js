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

  test('lists all 30 authors (15 Chinese + 15 English)', () => {
    const list = listAuthorStyles();
    assert.equal(list.length, 30);
    assert.equal(list.filter(s => s.category.startsWith('chinese-')).length, 15);
    assert.equal(list.filter(s => s.category.startsWith('english-')).length, 15);
    const keys = list.map(s => s.key).sort();
    assert.ok(keys.includes('moyan'));
    assert.ok(keys.includes('jinyong'));
    assert.ok(keys.includes('liucixin'));
    assert.ok(keys.includes('priest'));
    assert.ok(keys.includes('hemingway'));
    assert.ok(keys.includes('tolkien'));
  });

  test('all 15 English authors load with a non-empty Scene voice', () => {
    const expected = [
      'hemingway', 'austen', 'dickens', 'twain', 'fitzgerald',
      'woolf', 'orwell', 'morrison', 'mccarthy',
      'king', 'christie', 'poe', 'chandler',
      'tolkien', 'gaiman',
    ];
    for (const key of expected) {
      const s = getAuthorStyle(key);
      assert.ok(s, `missing author style: ${key}`);
      assert.match(s.category, /^english-/);
      assert.ok(s.scene && s.scene.length > 0, `empty Scene for ${key}`);
    }
  });

  test('English authors resolve by full name, space/case-insensitive', () => {
    assert.equal(getAuthorStyle('Ernest Hemingway').name, 'Ernest Hemingway');
    assert.equal(getAuthorStyle('stephen king').name, 'Stephen King');
    assert.equal(getAuthorStyle('J.R.R. Tolkien').name, 'J.R.R. Tolkien');
    assert.equal(getAuthorStyle('AGATHA CHRISTIE').name, 'Agatha Christie');
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
