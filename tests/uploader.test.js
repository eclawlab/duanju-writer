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

  describe('canonical scene wire shape', () => {
    function fullDrama() {
      return {
        title: '战神归来',
        synopsis: '钩子',
        trope: '战神归来',
        genre: '都市',
        genres: ['复仇'],
        tags: ['打脸'],
        lang: 'cn',
        characters: [{ name: '陆衡', role: 'protagonist', description: '...' }],
        episodes: [
          {
            episodeIndex: 0,
            title: '第1集',
            isEnding: false,
            ending: null,
            scenes: [
              {
                content: '[narrator]\n夜雨\n\n[narrator]\n推门\n\n[character:陆衡]\n三年了\n\n[narrator]\n钩点',
                choices: [],
                conclusion: null,
              },
            ],
          },
          {
            episodeIndex: 1,
            title: '终局',
            isEnding: true,
            ending: '爽爆',
            scenes: [
              {
                content: '[narrator]\n灯熄\n\n[character:陆衡]\n这局我赢',
                choices: [],
                conclusion: { title: 't', overview: 'o', type: 'STORY_END', ending: 'GOOD' },
              },
            ],
          },
        ],
      };
    }

    test('wire payload contains scenes, not clips', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const { options } = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.equal(body.episodes[0].scenes.length, 1);
      assert.equal(body.episodes[0].clips, undefined);
      assert.equal(body.episodes[0].scenes[0].content.length > 0, true);
    });

    test('genre (singular) is prepended to genres[] on the wire', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const { options } = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.deepEqual(body.genres, ['都市', '复仇']);
      assert.equal(body.genre, undefined);
    });

    test('trope is pushed into tags[] on the wire', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const { options } = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.deepEqual(body.tags, ['战神归来', '打脸']);
      assert.equal(body.trope, undefined);
    });

    test('wire payload omits format, lang, characters', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const { options } = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.equal(body.format, undefined);
      assert.equal(body.lang, undefined);
      assert.equal(body.characters, undefined);
    });

    test('wire payload omits episode.isEnding and episode.ending', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const { options } = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      for (const ep of body.episodes) {
        assert.equal(ep.isEnding, undefined, 'isEnding leaked');
        assert.equal(ep.ending, undefined, 'ending leaked');
      }
    });

    test('episode wire shape carries title, episodeIndex, scenes', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const { options } = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      const ep = body.episodes[0];
      assert.equal(ep.title, '第1集');
      assert.equal(ep.episodeIndex, 0);
      assert.ok(Array.isArray(ep.scenes));
    });

    test('idempotencyKey appears as Idempotency-Key header but NOT in body', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const req = buildRequest(fullDrama(), { autostoryUrl: 'http://x', aiApiKey: 'k' }, { idempotencyKey: 'job-1.v1' });
      assert.equal(req.options.headers['Idempotency-Key'], 'job-1.v1');
      const body = JSON.parse(req.options.body);
      assert.equal(body.idempotencyKey, undefined);
    });

    test('handles drama with no genre, no trope (falsy filter)', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const drama = fullDrama();
      delete drama.genre;
      delete drama.trope;
      const { options } = buildRequest(drama, { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.deepEqual(body.genres, ['复仇']);
      assert.deepEqual(body.tags, ['打脸']);
    });

    test('handles drama with no genres / tags arrays', async () => {
      const { buildRequest } = await import('../src/uploader.js');
      const drama = fullDrama();
      drama.genres = undefined;
      drama.tags = undefined;
      const { options } = buildRequest(drama, { autostoryUrl: 'http://x', aiApiKey: 'k' });
      const body = JSON.parse(options.body);
      assert.deepEqual(body.genres, ['都市']);
      assert.deepEqual(body.tags, ['战神归来']);
    });
  });
});
