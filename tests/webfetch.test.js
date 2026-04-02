import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('webfetch', () => {
  test('extractContent strips scripts and styles', async () => {
    const { extractContent } = await import('../src/webfetch.js');
    const html = '<html><script>alert(1)</script><style>.x{}</style><p>Hello</p></html>';
    const content = extractContent(html);
    assert.ok(!content.includes('alert'));
    assert.ok(!content.includes('.x{}'));
    assert.ok(content.includes('Hello'));
  });

  test('extractContent converts block elements to newlines', async () => {
    const { extractContent } = await import('../src/webfetch.js');
    const html = '<p>Line 1</p><p>Line 2</p>';
    const content = extractContent(html);
    assert.ok(content.includes('Line 1'));
    assert.ok(content.includes('Line 2'));
  });

  test('extractContent decodes HTML entities', async () => {
    const { extractContent } = await import('../src/webfetch.js');
    const html = '<p>A &amp; B &lt; C</p>';
    const content = extractContent(html);
    assert.ok(content.includes('A & B < C'));
  });

  test('extractContent truncates at max length', async () => {
    const { extractContent } = await import('../src/webfetch.js');
    const longContent = '<p>' + 'x'.repeat(60_000) + '</p>';
    const content = extractContent(longContent);
    assert.ok(content.length <= 50_000);
  });

  test('extractContent removes noscript blocks', async () => {
    const { extractContent } = await import('../src/webfetch.js');
    const html = '<noscript>Hidden</noscript><p>Visible</p>';
    const content = extractContent(html);
    assert.ok(!content.includes('Hidden'));
    assert.ok(content.includes('Visible'));
  });

  test('extractTitle extracts title from HTML', async () => {
    const { extractTitle } = await import('../src/webfetch.js');
    assert.equal(extractTitle('<html><title>My Page</title></html>'), 'My Page');
  });

  test('extractTitle returns undefined when no title', async () => {
    const { extractTitle } = await import('../src/webfetch.js');
    assert.equal(extractTitle('<html><body>No title</body></html>'), undefined);
  });

  test('extractTitle decodes entities in title', async () => {
    const { extractTitle } = await import('../src/webfetch.js');
    assert.equal(extractTitle('<title>A &amp; B</title>'), 'A & B');
  });

  test('fetchPage throws on empty URL', async () => {
    const { fetchPage } = await import('../src/webfetch.js');
    await assert.rejects(() => fetchPage(''), /URL cannot be empty/);
    await assert.rejects(() => fetchPage('   '), /URL cannot be empty/);
  });
});
