import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyUploadAuth } from '../src/uploader.js';

const cfg = (over = {}) => ({ autostoryUrl: 'https://example.test', aiApiKey: 'k', ...over });

test('fails fast when no API key is configured (no network call)', async () => {
  let called = false;
  const res = await verifyUploadAuth({
    config: cfg({ aiApiKey: '' }),
    fetchFn: async () => { called = true; return { status: 200 }; },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /No upload API key configured/);
  assert.equal(called, false, 'must not hit the network when key is absent');
});

test('treats whitespace-only key as missing', async () => {
  const res = await verifyUploadAuth({ config: cfg({ aiApiKey: '   ' }), fetchFn: async () => ({ status: 200 }) });
  assert.equal(res.ok, false);
});

test('sends X-Api-Key on the probe and accepts a 404 (key works, story absent)', async () => {
  let seenHeaders;
  const res = await verifyUploadAuth({
    config: cfg(),
    fetchFn: async (url, opts) => { seenHeaders = opts.headers; return { status: 404, text: async () => 'not found' }; },
  });
  assert.equal(res.ok, true);
  assert.equal(seenHeaders['X-Api-Key'], 'k');
});

test('blocks on 401 with a clear, actionable error', async () => {
  const res = await verifyUploadAuth({
    config: cfg(),
    fetchFn: async () => ({ status: 401, text: async () => 'Missing API key' }),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /rejected the configured key \(HTTP 401\)/);
});

test('blocks on 403 too', async () => {
  const res = await verifyUploadAuth({ config: cfg(), fetchFn: async () => ({ status: 403, text: async () => '' }) });
  assert.equal(res.ok, false);
});

test('network error is inconclusive — does not block (ok:true + warning)', async () => {
  const res = await verifyUploadAuth({
    config: cfg(),
    fetchFn: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(res.ok, true);
  assert.match(res.warning, /could not reach/);
});

test('200 from probe means the key is accepted', async () => {
  const res = await verifyUploadAuth({ config: cfg(), fetchFn: async () => ({ status: 200, text: async () => '{}' }) });
  assert.equal(res.ok, true);
});
