import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRaw,
  extractJsonObject,
  parseJsonLoose,
  tryParseJson,
  repairJson,
  parseJsonWithRepair,
} from '../src/json.js';

test('cleanRaw strips markdown fences and whitespace', () => {
  assert.equal(cleanRaw('  {"a":1}  '), '{"a":1}');
  assert.equal(cleanRaw('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(cleanRaw('```\n{"a":1}\n```'), '{"a":1}');
  // Coerces non-strings without throwing.
  assert.equal(cleanRaw(null), 'null');
});

test('extractJsonObject slices first { to last }', () => {
  assert.deepEqual(extractJsonObject('prose {"a":1} trailing'), { a: 1 });
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject('} backwards {'), null);
});

test('parseJsonLoose parses cleaned text directly then extracts', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":1}'), { a: 1 });
  assert.equal(parseJsonLoose('garbage'), null);
});

test('tryParseJson handles fences + surrounding prose', () => {
  assert.deepEqual(tryParseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(tryParseJson('I\'ll output: {"a":[1,2]}'), { a: [1, 2] });
  assert.equal(tryParseJson('not json'), null);
});

test('repairJson invokes injected llm and re-parses', async () => {
  let called = 0;
  const llmFn = async () => { called++; return '{"fixed":true}'; };
  const result = await repairJson('{bad json', 'test', llmFn);
  assert.equal(called, 1);
  assert.deepEqual(result, { fixed: true });
});

test('repairJson throws when repair still fails', async () => {
  const llmFn = async () => 'still not json';
  await assert.rejects(() => repairJson('{bad', 'test', llmFn), /even after LLM repair/);
});

test('parseJsonWithRepair skips repair on valid input', async () => {
  let called = 0;
  const llmFn = async () => { called++; return '{}'; };
  const result = await parseJsonWithRepair('{"a":1}', 'test', llmFn);
  assert.deepEqual(result, { a: 1 });
  assert.equal(called, 0, 'repair must not be called when primary parse succeeds');
});

test('parseJsonWithRepair falls back to repair on invalid input', async () => {
  let called = 0;
  const llmFn = async () => { called++; return '{"repaired":1}'; };
  const result = await parseJsonWithRepair('{broken', 'test', llmFn);
  assert.deepEqual(result, { repaired: 1 });
  assert.equal(called, 1);
});
