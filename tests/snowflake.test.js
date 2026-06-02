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

describe('snowflake bible injection', () => {
  test('buildSnowflakePrompt with bible+fidelity appends bible block', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: '归来', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: ['复仇'], world: 'w', ending: 'e',
    };
    const out = buildSnowflakePrompt({}, 0, [], 'cn', '', '', '', { bible, fidelity: 'medium' });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(out.includes('Fidelity = medium'));
  });

  test('buildSnowflakePrompt without bible omits bible block', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const out = buildSnowflakePrompt({}, 0, [], 'cn');
    assert.ok(!out.includes('## 参考小说'));
  });
});

describe('snowflake llmFn injection', () => {
  // Regression: generateSnowflake called the real callLLM directly (no injection
  // point), so even when a caller threaded a canned llmFn through generateDrama,
  // snowflake escaped the mock and spawned the real `claude` CLI — making the
  // drama-writer e2e/llmfn tests take minutes each. The injected fn must drive
  // every snowflake step.
  test('generateSnowflake uses the injected llmFn for every step (no real callLLM)', async () => {
    const { generateSnowflake, PARTS } = await import('../src/snowflake.js');
    let calls = 0;
    const llmFn = async (_prompt, role) => {
      calls++;
      assert.equal(role, 'outline', 'snowflake steps use the outline role');
      return JSON.stringify({ coreSeed: 'SEED', characters: [], world: {}, plot: {} });
    };
    const snowflake = await generateSnowflake({ topics: [] }, { lang: 'en', llmFn });
    assert.equal(calls, PARTS.length, 'injected llmFn must be called once per snowflake step');
    assert.equal(snowflake.coreSeed, 'SEED', 'snowflake content must derive from the injected fn');
  });
});
