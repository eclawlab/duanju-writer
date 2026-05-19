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
  test('buildMetaPrompt embeds metadata + feedback but NOT episode bodies', async () => {
    const { buildMetaPrompt } = await import('../src/modifier.js');
    const p = buildMetaPrompt(sampleDrama(), '把标题改得更抓人', 'cn');
    assert.ok(p.includes('[METADATA_PASS]'));
    assert.ok(p.includes('把标题改得更抓人'));
    assert.ok(p.includes('原标题'));
    // Episode scene content must be excluded so the prompt stays small.
    assert.ok(!p.includes('[character:陆衡]'));
    assert.ok(!p.includes('{{feedback}}'));
    assert.ok(!p.includes('{{meta}}'));
    assert.ok(!p.includes('{{lang}}'));
  });

  test('buildEpisodePrompt embeds ONE episode + global context + feedback', async () => {
    const { buildEpisodePrompt } = await import('../src/modifier.js');
    const d = sampleDrama();
    const p = buildEpisodePrompt(d, d.episodes[1], '把第2集结尾加一个反转', 2, 2, 'cn');
    assert.ok(p.includes('[EPISODE_PASS]'));
    assert.ok(p.includes('把第2集结尾加一个反转'));
    assert.ok(p.includes('[character:陆衡]')); // this episode's content
    assert.ok(p.includes('原标题')); // global context
    assert.ok(p.includes('第 2 / 2 集'));
    // Only the targeted episode is embedded, not episode 1's content.
    assert.ok(!p.includes('开场'));
    assert.ok(!p.includes('{{episode}}'));
    assert.ok(!p.includes('{{feedback}}'));
  });

  test('build*Prompt does not interpret $ in feedback as regex replacement', async () => {
    const { buildMetaPrompt, buildEpisodePrompt } = await import('../src/modifier.js');
    const fb = 'cost is $5 and $$ and $&';
    const d = sampleDrama();
    assert.ok(buildMetaPrompt(d, fb, 'cn').includes(fb));
    assert.ok(buildEpisodePrompt(d, d.episodes[0], fb, 1, 2, 'cn').includes(fb));
  });

  // Regression: a global feedback must be applied across the WHOLE novel,
  // not just the first few episodes. The old single-pass implementation
  // stuffed the entire novel into one prompt and the model degraded into
  // verbatim copying after the first episodes, leaving most untouched.
  test('applyFeedback applies feedback to EVERY episode, not just the first', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const drama = {
      title: 'T', synopsis: 'S', lang: 'cn', characters: [{ name: 'A' }],
      episodes: [0, 1, 2, 3, 4].map((i) => ({
        title: `第${i}集`, episodeIndex: i,
        scenes: [{ content: '[narrator]\nOLD', choices: [], conclusion: null }],
      })),
    };
    let episodeCalls = 0;
    const llmFn = async (prompt) => {
      if (prompt.includes('[EPISODE_PASS]')) {
        episodeCalls++;
        return JSON.stringify({ scenes: [{ content: '[narrator]\nNEW', choices: [], conclusion: null }] });
      }
      return JSON.stringify({ title: 'T' });
    };
    const out = await applyFeedback(drama, 'replace OLD with NEW everywhere', { llmFn });
    assert.equal(episodeCalls, 5, 'expected one LLM call per episode');
    assert.equal(out.episodes.length, 5);
    for (const ep of out.episodes) {
      assert.ok(ep.scenes[0].content.includes('NEW'), `episode ${ep.episodeIndex} not modified`);
      assert.ok(!ep.scenes[0].content.includes('OLD'), `episode ${ep.episodeIndex} still has OLD`);
    }
  });

  // Builds an llmFn that answers the metadata pass and per-episode passes
  // differently, branching on the template marker.
  function passAwareLLM({ meta, episode }) {
    return async (prompt) => (prompt.includes('[EPISODE_PASS]') ? episode(prompt) : meta(prompt));
  }

  test('applyFeedback applies the metadata revision and preserves episode structure', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = passAwareLLM({
      meta: async () => JSON.stringify({ title: '新标题' }),
      episode: async () => JSON.stringify({
        scenes: [{ content: '[narrator]\n改写后的正文', choices: [], conclusion: null }],
      }),
    });
    const out = await applyFeedback(sampleDrama(), '改标题', { llmFn });
    assert.equal(out.title, '新标题');
    assert.equal(out.episodes.length, 2);
    assert.equal(out.episodes[1].episodeIndex, 1); // index never renumbered
    assert.equal(out.episodes[1].ending, '爽爆'); // optional field preserved
    assert.ok(out.episodes[0].scenes[0].content.includes('改写后的正文'));
  });

  test('applyFeedback tolerates fenced/prefixed JSON in both passes', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = passAwareLLM({
      meta: async () => '好的：\n```json\n' + JSON.stringify({ title: 'X' }) + '\n```',
      episode: async () => '```json\n' + JSON.stringify({ scenes: [{ content: '[narrator]\nz' }] }) + '\n```',
    });
    const out = await applyFeedback(sampleDrama(), 'f', { llmFn });
    assert.equal(out.title, 'X');
    assert.equal(out.episodes.length, 2);
  });

  test('applyFeedback falls back to the original episode when a pass yields no usable scenes', async () => {
    // A flaky per-episode response must not blank part of the novel.
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = passAwareLLM({
      meta: async () => JSON.stringify({ title: '只改了标题' }),
      episode: async () => JSON.stringify({ title: '空', scenes: [] }), // no scene content
    });
    const out = await applyFeedback(sampleDrama(), 'f', { llmFn });
    assert.equal(out.title, '只改了标题');
    assert.equal(out.episodes.length, 2);
    assert.equal(out.episodes[0].scenes[0].content, sampleDrama().episodes[0].scenes[0].content);
    assert.equal(out.characters.length, 1);
  });

  test('applyFeedback keeps episode count fixed (no add/delete via feedback)', async () => {
    // Architecture change: the per-episode rewrite iterates the ORIGINAL
    // episodes, so a model trying to empty the novel cannot delete episodes.
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = passAwareLLM({
      meta: async () => JSON.stringify({}),
      episode: async () => JSON.stringify({ scenes: [] }),
    });
    const out = await applyFeedback(sampleDrama(), 'delete everything', { llmFn });
    assert.equal(out.episodes.length, 2);
    assert.ok(out.episodes[0].scenes[0].content); // original body preserved
  });

  test('applyFeedback is resilient to unparseable responses (never destroys content)', async () => {
    const { applyFeedback } = await import('../src/modifier.js');
    const llmFn = async () => 'sorry I cannot do that';
    const out = await applyFeedback(sampleDrama(), 'f', { llmFn });
    assert.equal(out.title, '原标题'); // metadata fell back
    assert.equal(out.episodes.length, 2);
    assert.equal(out.episodes[0].scenes[0].content, sampleDrama().episodes[0].scenes[0].content);
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
