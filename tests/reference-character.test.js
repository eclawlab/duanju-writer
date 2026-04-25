import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const CHAR_MD = `# Character: 林昭

Role: Protagonist
Background: Former military medic turned wandering herbalist.
Motivation: revenge on the general who killed her unit.
Arc: starts numb, meets an orphan, chooses mercy in the end.
`;

describe('reference character — prompt injection', () => {
  test('buildSnowflakePrompt omits section when referenceCharacter is empty', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 0, [], 'en', '');
    assert.ok(!prompt.includes('Reference Character'), 'section should be absent when no character provided');
  });

  test('buildSnowflakePrompt includes reference character section (EN)', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 0, [], 'en', '', CHAR_MD);
    assert.ok(prompt.includes('Reference Character (REQUIRED)'), 'EN section header missing');
    assert.ok(prompt.includes('林昭'), 'character name from md should be embedded');
  });

  test('buildSnowflakePrompt emphasizes character dynamics step', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const step1 = buildSnowflakePrompt(materials, 1, [], 'en', '', CHAR_MD);
    const step0 = buildSnowflakePrompt(materials, 0, [], 'en', '', CHAR_MD);
    assert.ok(step1.includes('characters array'), 'character-step should emphasize inclusion in characters array');
    assert.ok(!step0.includes('characters array'), 'non-character steps should not include that emphasis');
  });

  test('buildSnowflakePrompt uses CN text for cn lang', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildSnowflakePrompt(materials, 1, [], 'cn', '', CHAR_MD);
    assert.ok(prompt.includes('参考角色'), 'CN section header missing');
    assert.ok(prompt.includes('林昭'), 'character content should be embedded in CN prompt');
  });

  test('buildOutlinePrompt includes reference character section (EN)', async () => {
    const { buildOutlinePrompt } = await import('../src/writer.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'en', undefined, '', CHAR_MD);
    assert.ok(prompt.includes('Reference Character (REQUIRED)'), 'EN section header missing in outline');
    assert.ok(prompt.includes('林昭'), 'character content should be in outline prompt');
  });

  test('buildOutlinePrompt omits section when referenceCharacter empty', async () => {
    const { buildOutlinePrompt } = await import('../src/writer.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'en', undefined, '', '');
    assert.ok(!prompt.includes('Reference Character'), 'section should be absent when no character provided');
  });

  test('buildPlanPrompt includes reference character section (EN)', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: 'Test', episodes: [{ title: 'Ep 1', scenePlan: [{ summary: 'Scene 1' }] }] };
    const prompt = buildPlanPrompt(outline, 'en', '', CHAR_MD);
    assert.ok(prompt.includes('Reference Character (REQUIRED)'), 'EN section header missing in plan');
    assert.ok(prompt.includes('林昭'), 'character content should be in plan prompt');
  });

  test('buildPlanPrompt uses CN text for cn lang', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: 'Test', episodes: [] };
    const prompt = buildPlanPrompt(outline, 'cn', '', CHAR_MD);
    assert.ok(prompt.includes('参考角色'), 'CN section header missing in plan');
  });

  test('reference character and novelType coexist in one prompt', async () => {
    const { buildOutlinePrompt } = await import('../src/writer.js');
    const materials = { topics: ['adventure'], plotHooks: [] };
    const prompt = buildOutlinePrompt(materials, 'en', undefined, 'thriller', CHAR_MD);
    assert.ok(prompt.includes('thriller'), 'novelType should still be present');
    assert.ok(prompt.includes('林昭'), 'reference character should still be present');
  });
});

describe('reference character — queue snapshot', () => {
  test('createJobIn persists referenceCharacter content in job options', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createJobIn, getJobFrom } = await import('../src/queue.js');

    const dir = mkdtempSync(join(tmpdir(), 'sw-refchar-'));
    try {
      const jobsFile = join(dir, 'jobs.json');
      const jobsDir = join(dir, 'jobs');
      const job = createJobIn(jobsFile, jobsDir, {
        lang: 'en',
        referenceCharacter: CHAR_MD,
      });
      const reloaded = getJobFrom(jobsFile, job.id);
      assert.equal(reloaded.options.referenceCharacter, CHAR_MD, 'content should round-trip through job storage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reference character — config default', () => {
  test('referenceCharacter defaults to empty string', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadConfigFrom } = await import('../src/config.js');

    const dir = mkdtempSync(join(tmpdir(), 'sw-refchar-cfg-'));
    try {
      const cfgFile = join(dir, 'config.json');
      const cfg = loadConfigFrom(cfgFile);
      assert.equal(cfg.referenceCharacter, '', 'default should be empty string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
