import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function sampleDrama() {
  return {
    title: '原标题',
    synopsis: '原梗概',
    lang: 'cn',
    genre: '都市',
    genres: ['都市'],
    tags: ['打脸'],
    characters: [{ name: '陆衡', role: 'protagonist', description: 'd', arc: 'a' }],
    episodes: [
      { title: '第1集', episodeIndex: 0, scenes: [{ content: '[narrator]\n开场', choices: [], conclusion: null }] },
      { title: '第2集', episodeIndex: 1, isEnding: true, ending: '爽爆', scenes: [{ content: '[character:陆衡]\n这局我赢', choices: [], conclusion: null }] },
    ],
  };
}

describe('modifier', () => {
  test('buildModifyPrompt embeds story JSON, feedback, and lang', async () => {
    const { buildModifyPrompt } = await import('../src/modifier.js');
    const p = buildModifyPrompt(sampleDrama(), '把第1集结尾加一个反转', 'cn');
    assert.ok(p.includes('把第1集结尾加一个反转'));
    assert.ok(p.includes('原标题'));
    assert.ok(p.includes('[character:陆衡]'));
    assert.ok(!p.includes('{{feedback}}'));
    assert.ok(!p.includes('{{drama}}'));
    assert.ok(!p.includes('{{lang}}'));
  });

  test('buildModifyPrompt does not interpret $ in feedback as regex replacement', async () => {
    const { buildModifyPrompt } = await import('../src/modifier.js');
    const p = buildModifyPrompt(sampleDrama(), 'cost is $5 and $$ and $&', 'cn');
    assert.ok(p.includes('cost is $5 and $$ and $&'));
  });

  test('applyFeedback applies the model revision and preserves structure', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = async () => JSON.stringify({
      ...sampleDrama(),
      title: '新标题',
      episodes: sampleDrama().episodes.map((e) => ({ ...e })),
    });
    const out = await applyFeedback(sampleDrama(), '改标题', { llmFn });
    assert.equal(out.title, '新标题');
    assert.equal(out.episodes.length, 2);
    assert.equal(out.episodes[1].ending, '爽爆');
  });

  test('applyFeedback tolerates fenced/prefixed JSON', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = async () => '好的：\n```json\n' + JSON.stringify({ ...sampleDrama(), title: 'X' }) + '\n```';
    const out = await applyFeedback(sampleDrama(), 'f', { llmFn });
    assert.equal(out.title, 'X');
  });

  test('applyFeedback falls back to original episodes when model drops them', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = async () => JSON.stringify({ title: '只改了标题', episodes: [] });
    const out = await applyFeedback(sampleDrama(), 'f', { llmFn });
    assert.equal(out.title, '只改了标题');
    assert.equal(out.episodes.length, 2); // original episodes preserved
    assert.equal(out.characters.length, 1);
  });

  test('applyFeedback throws on unparseable response', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = async () => 'sorry I cannot do that';
    await assert.rejects(applyFeedback(sampleDrama(), 'f', { llmFn }), /not parseable JSON/);
  });

  test('applyFeedback requires feedback', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    await assert.rejects(applyFeedback(sampleDrama(), '   ', { llmFn: async () => '{}' }), /feedback is required/);
  });

  test('modifyStory: download → modify → upload as a NEW novel', async () => {
    const { modifyStory } = await import('../src/modifier.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'modtest-'));
    let uploadedDrama = null;
    let uploadVariationOpts = 'NOT_CALLED';
    const result = await modifyStory({
      storyId: 'orig-1',
      feedback: '让结局更爽',
      dataDir,
      downloadFn: async (id) => {
        assert.equal(id, 'orig-1');
        return { drama: sampleDrama() };
      },
      llmFn: async () => JSON.stringify({ ...sampleDrama(), title: '改后的标题' }),
      uploadFn: async (drama, variationOpts) => {
        uploadedDrama = drama;
        uploadVariationOpts = variationOpts;
        return { success: true, storyId: 'new-99' };
      },
    });
    assert.equal(result.originalStoryId, 'orig-1');
    assert.equal(result.newStoryId, 'new-99');
    assert.equal(uploadedDrama.title, '改后的标题');
    // No variation options ⇒ platform creates a standalone new novel.
    assert.equal(uploadVariationOpts, undefined);
    // Artifacts persisted.
    const subdirs = readdirSync(join(dataDir, 'modifications'));
    assert.equal(subdirs.length, 1);
    const dir = join(dataDir, 'modifications', subdirs[0]);
    assert.ok(existsSync(join(dir, 'original.json')));
    assert.ok(existsSync(join(dir, 'modified.json')));
    assert.ok(existsSync(join(dir, 'feedback.txt')));
    assert.equal(readFileSync(join(dir, 'feedback.txt'), 'utf8'), '让结局更爽');
    const res = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    assert.equal(res.newStoryId, 'new-99');
  });

  test('modifyStory: --title overrides the modified title', async () => {
    const { modifyStory } = await import('../src/modifier.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'modtest-'));
    let uploaded = null;
    await modifyStory({
      storyId: 's', feedback: 'f', title: '强制标题', dataDir,
      downloadFn: async () => ({ drama: sampleDrama() }),
      llmFn: async () => JSON.stringify({ ...sampleDrama(), title: 'ignored' }),
      uploadFn: async (d) => { uploaded = d; return { success: true, storyId: 'n' }; },
    });
    assert.equal(uploaded.title, '强制标题');
  });

  test('modifyStory: dryRun skips upload but writes artifacts', async () => {
    const { modifyStory } = await import('../src/modifier.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'modtest-'));
    let uploadCalled = false;
    const result = await modifyStory({
      storyId: 's', feedback: 'f', dryRun: true, dataDir,
      downloadFn: async () => ({ drama: sampleDrama() }),
      llmFn: async () => JSON.stringify(sampleDrama()),
      uploadFn: async () => { uploadCalled = true; return { storyId: 'x' }; },
    });
    assert.equal(uploadCalled, false);
    assert.equal(result.newStoryId, null);
    const subdirs = readdirSync(join(dataDir, 'modifications'));
    const dir = join(dataDir, 'modifications', subdirs[0]);
    assert.ok(existsSync(join(dir, 'modified.json')));
    const res = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    assert.equal(res.dryRun, true);
  });

  test('modifyStory requires storyId and feedback', async () => {
    const { modifyStory } = await import('../src/modifier.js');
    await assert.rejects(modifyStory({ feedback: 'f' }), /storyId is required/);
    await assert.rejects(modifyStory({ storyId: 's' }), /feedback is required/);
  });
});
