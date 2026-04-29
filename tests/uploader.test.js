import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('uploader', () => {
  test('buildRequest creates correct URL and method', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test', synopsis: 'A test', episodes: [] };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'test-key' };
    const req = buildRequest(story, config);
    assert.equal(req.url, 'http://localhost:3001/api/ai/stories');
    assert.equal(req.options.method, 'POST');
  });

  test('buildRequest sets correct headers', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test' };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'my-secret-key' };
    const req = buildRequest(story, config);
    assert.equal(req.options.headers['Content-Type'], 'application/json');
    assert.equal(req.options.headers['X-Api-Key'], 'my-secret-key');
  });

  test('buildRequest includes story data in body', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test', synopsis: 'A test', episodes: [{ title: 'Ep1' }] };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key' };
    const req = buildRequest(story, config);
    const body = JSON.parse(req.options.body);
    assert.equal(body.title, 'Test');
    assert.equal(body.synopsis, 'A test');
    assert.equal(body.episodes[0].title, 'Ep1');
  });

  test('buildRequest sets publish from config.publishOnUpload', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test' };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key', publishOnUpload: true };
    const req = buildRequest(story, config);
    const body = JSON.parse(req.options.body);
    assert.equal(body.publish, true);
  });

  test('buildRequest sets publish false when config says so', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test' };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key', publishOnUpload: false };
    const req = buildRequest(story, config);
    const body = JSON.parse(req.options.body);
    assert.equal(body.publish, false);
  });

  test('buildRequest omits publish when publishOnUpload is undefined', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test' };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key' };
    // publishOnUpload is not set, so it's undefined
    const req = buildRequest(story, config);
    const body = JSON.parse(req.options.body);
    assert.equal(body.publish, undefined);
  });

  test('buildRequest handles custom URL', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test' };
    const config = { autostoryUrl: 'https://api.example.com', aiApiKey: 'key' };
    const req = buildRequest(story, config);
    assert.equal(req.url, 'https://api.example.com/api/ai/stories');
  });

  test('handleResponse extracts storyId from success', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    const result = handleResponse({
      ok: true,
      status: 201,
      body: { story: { id: 'abc123', title: 'Test' }, episodes: [] },
    });
    assert.equal(result.success, true);
    assert.equal(result.storyId, 'abc123');
    assert.ok(result.data);
  });

  test('handleResponse throws when 2xx body has no story.id', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    assert.throws(
      () => handleResponse({ ok: true, status: 200, body: {}, bodyText: '{}' }),
      /no story\.id in response/,
    );
  });

  test('handleResponse throws when 2xx body is null', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    assert.throws(
      () => handleResponse({ ok: true, status: 200, body: null, bodyText: '' }),
      /no story\.id in response/,
    );
  });

  test('handleResponse throws on HTTP error with error message', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    assert.throws(
      () => handleResponse({ ok: false, status: 400, body: { error: 'Missing title' } }),
      /Upload failed.*400.*Missing title/
    );
  });

  test('handleResponse throws on HTTP error without error body', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    assert.throws(
      () => handleResponse({ ok: false, status: 500, body: {} }),
      /Upload failed.*500.*HTTP 500/
    );
  });

  test('handleResponse throws on HTTP error with null body', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    assert.throws(
      () => handleResponse({ ok: false, status: 403, body: null }),
      /Upload failed.*403/
    );
  });

  test('handleResponse preserves full body in data field', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    const body = { story: { id: 's1' }, episodes: [{ id: 'e1' }], meta: { created: true } };
    const result = handleResponse({ ok: true, status: 201, body });
    assert.deepEqual(result.data, body);
  });

  test('buildRequest includes variationGroupId when provided', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test', synopsis: 'A test', episodes: [] };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key' };
    const req = buildRequest(story, config, { variationGroupId: 'group-123' });
    const body = JSON.parse(req.options.body);
    assert.equal(body.variationGroupId, 'group-123');
  });

  test('buildRequest includes variationLabel when provided', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test', synopsis: 'A test', episodes: [] };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key' };
    const req = buildRequest(story, config, { variationLabel: 'Path 1 · Good Ending' });
    const body = JSON.parse(req.options.body);
    assert.equal(body.variationLabel, 'Path 1 · Good Ending');
  });

  test('buildRequest omits variation fields when not provided', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test', synopsis: 'A test', episodes: [] };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key' };
    const req = buildRequest(story, config);
    const body = JSON.parse(req.options.body);
    assert.equal(body.variationGroupId, undefined);
    assert.equal(body.variationLabel, undefined);
  });

  test('buildRequest omits variation fields with empty options', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'Test', synopsis: 'A test', episodes: [] };
    const config = { autostoryUrl: 'http://localhost:3001', aiApiKey: 'key' };
    const req = buildRequest(story, config, {});
    const body = JSON.parse(req.options.body);
    assert.equal(body.variationGroupId, undefined);
    assert.equal(body.variationLabel, undefined);
  });

  describe('duanju payload shape', () => {
    function fullDrama() {
      return {
        title: '战神归来',
        synopsis: '钩子',
        trope: '战神归来',
        genre: '都市',
        tags: ['复仇'],
        lang: 'cn',
        characters: [{ name: '陆衡', role: 'protagonist', description: '...' }],
        episodes: [
          { episodeIndex: 0, title: '第1集', isEnding: false, ending: null,
            clips: [{
              clipIndex: 0, setting: 's', action: 'a', dialogue: 'd',
              hook: 'h', durationSec: 12, isConclusion: false, conclusion: null,
            }] },
        ],
      };
    }

    test('buildRequest emits format:duanju with new top-level fields', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const config = { autostoryUrl: 'http://x', aiApiKey: 'k', publishOnUpload: true };
      const { url, options } = buildRequest(fullDrama(), config, { variationGroupId: 'g1', variationLabel: '爽爆结局' });
      const body = JSON.parse(options.body);
      assert.equal(url, 'http://x/api/ai/stories');
      assert.equal(body.format, 'duanju');
      assert.equal(body.trope, '战神归来');
      assert.equal(body.genre, '都市');
      assert.equal(body.lang, 'cn');
      assert.equal(body.characters.length, 1);
      assert.equal(body.episodes[0].clips.length, 1);
      assert.equal(body.episodes[0].scenes, undefined);
      assert.equal(body.variationGroupId, 'g1');
      assert.equal(body.variationLabel, '爽爆结局');
      assert.equal(body.publish, true);
    });

    test('buildRequest does not strip episodeChoices (no longer generated)', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const drama = fullDrama();
      // Even if a stale episode object had episodeChoices, the new buildRequest
      // simply doesn't carry it forward — no error path.
      drama.episodes[0].episodeChoices = [{ text: 'X' }];
      const { options } = buildRequest(drama, { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.equal(body.episodes[0].episodeChoices, undefined);
    });

    test('buildRequest defaults lang to cn when missing', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const drama = fullDrama();
      delete drama.lang;
      const { options } = buildRequest(drama, { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.equal(body.lang, 'cn');
    });
  });
});
