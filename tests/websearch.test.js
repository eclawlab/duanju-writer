import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('websearch', () => {
  test('normalizeText strips HTML and decodes entities', async () => {
    const { normalizeText } = await import('../src/websearch.js');
    assert.equal(normalizeText('<b>Hello</b> &amp; <i>World</i>'), 'Hello & World');
  });

  test('normalizeText collapses whitespace', async () => {
    const { normalizeText } = await import('../src/websearch.js');
    assert.equal(normalizeText('  hello   world  '), 'hello world');
  });

  test('stripHtmlTags removes all tags', async () => {
    const { stripHtmlTags } = await import('../src/websearch.js');
    assert.equal(stripHtmlTags('<p>text</p>'), 'text');
    assert.equal(stripHtmlTags('<a href="url">link</a>'), 'link');
    assert.equal(stripHtmlTags('no tags'), 'no tags');
  });

  test('decodeHtmlEntities decodes common entities', async () => {
    const { decodeHtmlEntities } = await import('../src/websearch.js');
    assert.equal(decodeHtmlEntities('&amp;'), '&');
    assert.equal(decodeHtmlEntities('&lt;'), '<');
    assert.equal(decodeHtmlEntities('&gt;'), '>');
    assert.equal(decodeHtmlEntities('&quot;'), '"');
    assert.equal(decodeHtmlEntities('&#39;'), "'");
    assert.equal(decodeHtmlEntities('&nbsp;'), ' ');
  });

  test('decodeHtmlEntities decodes numeric entities', async () => {
    const { decodeHtmlEntities } = await import('../src/websearch.js');
    assert.equal(decodeHtmlEntities('&#20320;&#22909;'), '你好');
    assert.equal(decodeHtmlEntities('&#x4f60;&#x597d;'), '你好');
  });

  test('search throws on empty query', async () => {
    const { search } = await import('../src/websearch.js');
    await assert.rejects(() => search(''), /Query cannot be empty/);
    await assert.rejects(() => search('   '), /Query cannot be empty/);
  });
});
