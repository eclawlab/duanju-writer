import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/async.js';

test('preserves input order regardless of completion order', async () => {
  const out = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms, i) => {
    await new Promise(r => setTimeout(r, ms));
    return i * 10 + ms;
  });
  assert.deepEqual(out, [30, 20, 40, 35]);
});

test('respects the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 5));
    active--;
  });
  assert.ok(peak <= 3, `peak concurrency ${peak} should not exceed 3`);
});

test('empty input returns empty array', async () => {
  const out = await mapWithConcurrency([], 4, async () => 1);
  assert.deepEqual(out, []);
});

test('rejects on first task error', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; }),
    /boom/,
  );
});
