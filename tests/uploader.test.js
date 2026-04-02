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

  test('handleResponse returns null storyId when body has no story', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    const result = handleResponse({
      ok: true,
      status: 200,
      body: {},
    });
    assert.equal(result.success, true);
    assert.equal(result.storyId, null);
  });

  test('handleResponse returns null storyId when body is null', async () => {
    const { handleResponse } = await import('../src/uploader.js');
    const result = handleResponse({
      ok: true,
      status: 200,
      body: null,
    });
    assert.equal(result.success, true);
    assert.equal(result.storyId, null);
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
});
