import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const EVENT_MD = `# The Bridge Collapse

On the third morning of spring, the iron bridge linking the two
halves of town collapsed during rush hour. Thirty-seven people died.

## Key facts
- Bridge was scheduled for demolition; accident accelerated it.
- Inspector reports were later revealed to be forged.
- The mayor resigned within a month.

## Role in the story
This event is the inciting incident.
`;

const CHAR_MD = `# Character: 林昭\nRole: Protagonist\n`;

describe('reference event — prompt injection', () => {
  test('buildSnowflakePrompt omits section when referenceEvent is empty', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 0, [], 'en', '', '', '');
    assert.ok(!prompt.includes('Reference Event'), 'section should be absent when no event provided');
  });

  test('buildSnowflakePrompt includes reference event section (EN)', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 0, [], 'en', '', '', EVENT_MD);
    assert.ok(prompt.includes('Reference Event (REQUIRED)'), 'EN section header missing');
    assert.ok(prompt.includes('Bridge Collapse'), 'event content from md should be embedded');
  });

  test('buildSnowflakePrompt emphasizes plot architecture step', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const step3 = buildSnowflakePrompt(materials, 3, [], 'en', '', '', EVENT_MD);
    const step0 = buildSnowflakePrompt(materials, 0, [], 'en', '', '', EVENT_MD);
    assert.ok(step3.includes('three-act structure'), 'plot step should emphasize load-bearing beat in three-act structure');
    assert.ok(!step0.includes('three-act structure'), 'non-plot steps should not include that emphasis');
  });

  test('buildSnowflakePrompt uses CN text for cn lang', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 3, [], 'cn', '', '', EVENT_MD);
    assert.ok(prompt.includes('参考事件'), 'CN section header missing');
    assert.ok(prompt.includes('Bridge Collapse'), 'event content should be embedded in CN prompt');
  });

  test('buildOutlinePrompt includes reference event section (EN)', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'en', undefined, '', '', EVENT_MD);
    assert.ok(prompt.includes('Reference Event (REQUIRED)'), 'EN section header missing in outline');
    assert.ok(prompt.includes('Bridge Collapse'), 'event content should be in outline prompt');
  });

  test('buildOutlinePrompt omits section when referenceEvent empty', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'en', undefined, '', '', '');
    assert.ok(!prompt.includes('Reference Event'), 'section should be absent when no event provided');
  });

  test('buildPlanPrompt includes reference event section (EN)', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: 'Test', episodes: [{ title: 'Ep 1', scenePlan: [{ summary: 'Scene 1' }] }] };
    const prompt = buildPlanPrompt(outline, 'en', '', '', EVENT_MD);
    assert.ok(prompt.includes('Reference Event (REQUIRED)'), 'EN section header missing in plan');
    assert.ok(prompt.includes('Bridge Collapse'), 'event content should be in plan prompt');
  });

  test('buildPlanPrompt uses CN text for cn lang', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: 'Test', episodes: [] };
    const prompt = buildPlanPrompt(outline, 'cn', '', '', EVENT_MD);
    assert.ok(prompt.includes('参考事件'), 'CN section header missing in plan');
  });

  test('reference event, reference character, and novelType all coexist', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'en', undefined, 'thriller', CHAR_MD, EVENT_MD);
    assert.ok(prompt.includes('thriller'), 'novelType should still be present');
    assert.ok(prompt.includes('林昭'), 'reference character should still be present');
    assert.ok(prompt.includes('Bridge Collapse'), 'reference event should still be present');
  });

  test('snowflake step 3 can include both character and event emphasis simultaneously', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 3, [], 'en', '', CHAR_MD, EVENT_MD);
    // At step 3, event gets its plot emphasis, character gets the generic (non-emphasized) block
    assert.ok(prompt.includes('three-act structure'), 'event plot-step emphasis should be present at step 3');
    assert.ok(prompt.includes('Reference Character'), 'character block should still be present at step 3');
    assert.ok(prompt.includes('Reference Event'), 'event block should be present at step 3');
  });
});

describe('reference event — queue snapshot', () => {
  test('createJobIn persists referenceEvent content in job options', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createJobIn, getJobFrom } = await import('../src/queue.js');

    const dir = mkdtempSync(join(tmpdir(), 'sw-refevt-'));
    try {
      const jobsFile = join(dir, 'jobs.json');
      const jobsDir = join(dir, 'jobs');
      const job = createJobIn(jobsFile, jobsDir, {
        lang: 'en',
        referenceEvent: EVENT_MD,
      });
      const reloaded = getJobFrom(jobsFile, job.id);
      assert.equal(reloaded.options.referenceEvent, EVENT_MD, 'event content should round-trip through job storage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reference event — config default', () => {
  test('referenceEvent defaults to empty string', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadConfigFrom } = await import('../src/config.js');

    const dir = mkdtempSync(join(tmpdir(), 'sw-refevt-cfg-'));
    try {
      const cfgFile = join(dir, 'config.json');
      const cfg = loadConfigFrom(cfgFile);
      assert.equal(cfg.referenceEvent, '', 'default should be empty string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
