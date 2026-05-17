import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('downloader', () => {
  test('buildDownloadRequest creates correct URL, method, headers', async () => {
    const { buildDownloadRequest } = await import('../src/downloader.js');
    const req = buildDownloadRequest('abc123', { autostoryUrl: 'http://localhost:3001', aiApiKey: 'k' });
    assert.equal(req.url, 'http://localhost:3001/api/ai/stories/abc123');
    assert.equal(req.options.method, 'GET');
    assert.equal(req.options.headers['X-Api-Key'], 'k');
  });

  test('buildDownloadRequest url-encodes the storyId', async () => {
    const { buildDownloadRequest } = await import('../src/downloader.js');
    const req = buildDownloadRequest('a/b c', { autostoryUrl: 'http://x', aiApiKey: 'k' });
    assert.equal(req.url, 'http://x/api/ai/stories/a%2Fb%20c');
  });

  test('buildDownloadRequest throws without storyId', async () => {
    const { buildDownloadRequest } = await import('../src/downloader.js');
    assert.throws(() => buildDownloadRequest('', { autostoryUrl: 'http://x', aiApiKey: 'k' }), /storyId is required/);
  });

  test('normalizeStory reads a nested body.story envelope', async () => {
    const { normalizeStory } = await import('../src/downloader.js');
    const drama = normalizeStory({
      story: {
        id: 's1', title: 'T', synopsis: 'S', lang: 'cn',
        primaryGenre: '都市', trope: '战神归来',
        genres: ['都市', '复仇'], tags: ['战神归来', '打脸'],
        characters: [{ name: '陆衡', role: 'protagonist', description: 'd', arc: 'a' }],
        episodes: [{ title: 'E1', episodeIndex: 0, scenes: [{ content: '[narrator]\nx', choices: [], conclusion: null }] }],
      },
    });
    assert.equal(drama.title, 'T');
    assert.equal(drama.lang, 'cn');
    assert.equal(drama.genre, '都市');
    assert.equal(drama.trope, '战神归来');
    // Round-trip safety (audit #3): uploader prepends genre→genres[0] and
    // trope→tags[0], and the platform echoes the merged array back. So
    // normalizeStory strips the leading primary value to keep download→
    // upload idempotent (no unbounded duplication across modify cycles).
    assert.deepEqual(drama.genres, ['复仇']);
    assert.deepEqual(drama.tags, ['打脸']);
    assert.equal(drama.characters[0].name, '陆衡');
    assert.equal(drama.episodes[0].scenes[0].content, '[narrator]\nx');
  });

  test('normalizeStory reads a flat top-level body', async () => {
    const { normalizeStory } = await import('../src/downloader.js');
    const drama = normalizeStory({
      title: 'Flat', episodes: [{ title: 'E', scenes: [{ content: 'c' }] }],
    });
    assert.equal(drama.title, 'Flat');
    assert.equal(drama.episodes[0].episodeIndex, 0);
    assert.equal(drama.episodes[0].scenes[0].content, 'c');
    assert.deepEqual(drama.episodes[0].scenes[0].choices, []);
    assert.equal(drama.episodes[0].scenes[0].conclusion, null);
  });

  test('normalizeStory accepts legacy clips[] as scenes and preserves ending flags', async () => {
    const { normalizeStory } = await import('../src/downloader.js');
    const drama = normalizeStory({
      story: { title: 'T', episodes: [
        { title: 'End', episodeIndex: 5, isEnding: true, ending: '爽爆', clips: [{ content: 'z', hook: 'h' }] },
      ] },
    });
    assert.equal(drama.episodes[0].scenes[0].content, 'z');
    assert.equal(drama.episodes[0].scenes[0].hook, 'h');
    assert.equal(drama.episodes[0].isEnding, true);
    assert.equal(drama.episodes[0].ending, '爽爆');
  });

  test('normalizeStory drops characters without a name', async () => {
    const { normalizeStory } = await import('../src/downloader.js');
    const drama = normalizeStory({ title: 'T', characters: [{ role: 'x' }, { name: 'Y' }], episodes: [] });
    assert.equal(drama.characters.length, 1);
    assert.equal(drama.characters[0].name, 'Y');
  });

  test('normalizeStory throws on non-object body', async () => {
    const { normalizeStory } = await import('../src/downloader.js');
    assert.throws(() => normalizeStory(null), /no usable story body/);
  });

  test('handleDownloadResponse returns normalized drama on success', async () => {
    const { handleDownloadResponse } = await import('../src/downloader.js');
    const res = handleDownloadResponse({
      ok: true, status: 200,
      body: { story: { title: 'T', episodes: [{ title: 'E', scenes: [{ content: 'c' }] }] } },
    });
    assert.equal(res.success, true);
    assert.equal(res.drama.title, 'T');
  });

  test('handleDownloadResponse throws on HTTP error with error message', async () => {
    const { handleDownloadResponse } = await import('../src/downloader.js');
    assert.throws(
      () => handleDownloadResponse({ ok: false, status: 404, body: { error: 'Not found' } }),
      /Download failed.*404.*Not found/,
    );
  });

  test('handleDownloadResponse throws on 2xx with empty body', async () => {
    const { handleDownloadResponse } = await import('../src/downloader.js');
    assert.throws(
      () => handleDownloadResponse({ ok: true, status: 200, body: null, bodyText: '' }),
      /no JSON body/,
    );
  });

  test('handleDownloadResponse throws when story has no title and no episodes', async () => {
    const { handleDownloadResponse } = await import('../src/downloader.js');
    assert.throws(
      () => handleDownloadResponse({ ok: true, status: 200, body: { story: {} } }),
      /no title and no episodes/,
    );
  });
});
