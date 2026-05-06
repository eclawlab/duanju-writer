import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('parseRetryAfter', () => {
  test('Retry-After-Ms (numeric) wins when present', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter('5000', '999'), 5000);
  });

  test('Retry-After-Ms is ignored when not a positive number', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter('-5', '7'), 7000);
    assert.equal(parseRetryAfter('garbage', '7'), 7000);
    assert.equal(parseRetryAfter('0', '7'), 7000);
  });

  test('Retry-After numeric seconds → ms', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter(null, '60'), 60_000);
    assert.equal(parseRetryAfter(undefined, '   30   '), 30_000);
  });

  test('Retry-After HTTP-date in the future → diff in ms', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    const future = new Date(Date.now() + 90_000).toUTCString();
    const ms = parseRetryAfter(null, future);
    assert.ok(ms >= 80_000 && ms <= 100_000, `expected ~90000, got ${ms}`);
  });

  test('Retry-After HTTP-date in the past → fallback', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    const past = new Date(Date.now() - 1000).toUTCString();
    assert.equal(parseRetryAfter(null, past), 60_000);
  });

  test('both headers missing → 60000 fallback', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter(null, null), 60_000);
    assert.equal(parseRetryAfter(undefined, undefined), 60_000);
  });

  test('garbage Retry-After → fallback', async () => {
    const { parseRetryAfter } = await import('../src/llm.js');
    assert.equal(parseRetryAfter(null, 'not a date or number'), 60_000);
  });
});
