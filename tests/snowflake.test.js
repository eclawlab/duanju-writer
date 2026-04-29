import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('snowflake', () => {
  test('buildSnowflakePrompt includes materials', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: [{ title: 'Robot Uprising', premise: 'Machines gain free will' }] };
    const prompt = buildSnowflakePrompt(materials, 0, []);
    assert.ok(prompt.includes('Robot Uprising'));
    assert.ok(prompt.includes('Machines gain free will'));
  });

  test('buildSnowflakePrompt includes part title for partIndex 0 (en)', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: [] };
    const prompt = buildSnowflakePrompt(materials, 0, [], 'en');
    assert.ok(prompt.includes('Core Seed'));
  });

  test('buildSnowflakePrompt defaults to cn and uses CN part title for partIndex 0', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: [] };
    const prompt = buildSnowflakePrompt(materials, 0, []);
    assert.ok(prompt.includes('核心种子'), 'default lang=cn should produce CN part title');
  });

  test('buildSnowflakePrompt includes prior parts in instructions', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: [] };
    const priorParts = [{ coreSeed: 'A hero must save the world' }];
    const prompt = buildSnowflakePrompt(materials, 1, priorParts, 'en');
    assert.ok(prompt.includes('A hero must save the world'));
    assert.ok(prompt.includes('Previous parts for context'));
  });

  test('buildSnowflakePrompt uses CN template for cn lang', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: [] };
    const prompt = buildSnowflakePrompt(materials, 0, [], 'cn');
    assert.ok(prompt.includes('雪花法'));
  });

  test('PARTS has 4 entries', async () => {
    const { PARTS } = await import('../src/snowflake.js');
    assert.equal(PARTS.length, 4);
  });

  test('PARTS covers all 4 stages', async () => {
    const { PARTS } = await import('../src/snowflake.js');
    const titles = PARTS.map(p => p.title);
    assert.deepEqual(titles, ['Core Seed', 'Character Dynamics', 'World Building', 'Plot Architecture']);
  });
});
