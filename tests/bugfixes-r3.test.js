import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ──────────────────────────────────────────────────────────────────────────────
// R3 Fix #1 — uploader fetch timeout. Without an AbortSignal, a hung AutoStory
// API blocks the worker indefinitely; the job-level retry can't help if the
// job never returns. Verifies buildRequest sets a signal and surfaces a clean
// error on timeout.
// ──────────────────────────────────────────────────────────────────────────────
describe('R3 Fix #1 — uploader timeout', () => {
  test('buildRequest attaches an AbortSignal with the configured timeout', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'T', synopsis: 'S', episodes: [] };
    const config = {
      autostoryUrl: 'https://example.test',
      aiApiKey: 'k',
      uploadTimeout: 5000,
    };
    const { options, timeoutMs } = buildRequest(story, config);
    assert.equal(timeoutMs, 5000, 'configured timeout should round-trip');
    assert.ok(options.signal, 'fetch options should carry an AbortSignal');
    assert.equal(typeof options.signal.aborted, 'boolean', 'signal should look like an AbortSignal');
  });

  test('buildRequest falls back to default timeout when config omits uploadTimeout', async () => {
    const { buildRequest } = await import('../src/uploader.js');
    const story = { title: 'T', synopsis: 'S', episodes: [] };
    const config = { autostoryUrl: 'https://example.test', aiApiKey: 'k' };
    const { timeoutMs } = buildRequest(story, config);
    assert.equal(timeoutMs, 60_000, 'default upload timeout should be 60s');
  });

  test('upload() translates TimeoutError-shaped fetch reject into a clear timeout message', async () => {
    const { upload } = await import('../src/uploader.js');
    const realFetch = globalThis.fetch;
    // Mock fetch to reject immediately with the same shape AbortSignal.timeout
    // produces — that's all the upload() error-translation path inspects.
    globalThis.fetch = () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      err.code = 23;
      return Promise.reject(err);
    };
    try {
      await assert.rejects(
        upload({ title: 'T', synopsis: 'S', episodes: [] }),
        /Upload timed out after \d+ms/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('upload() passes through non-timeout fetch errors unchanged', async () => {
    const { upload } = await import('../src/uploader.js');
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('econnreset'));
    try {
      await assert.rejects(
        upload({ title: 'T', synopsis: 'S', episodes: [] }),
        /econnreset/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// R3 Fix #2 — drama-state add* functions warn on duplicate-name overwrite so
// LLM-emitted duplicate entries are visible in logs instead of silently losing
// the prior entry's knowledge / status / location.
// ──────────────────────────────────────────────────────────────────────────────
describe('R3 Fix #2 — drama-state silent overwrite warnings', () => {
  function captureWarn(fn) {
    const warnings = [];
    const orig = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try { fn(); } finally { console.warn = orig; }
    return warnings;
  }

  test('addCharacter warns on duplicate name (prior data is overwritten)', async () => {
    const { createState, addCharacter } = await import('../src/drama-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'home', knowledge: ['s1'], emotional: 'calm' });

    const warnings = captureWarn(() =>
      addCharacter(state, { name: 'Alice', status: 'alive', location: 'home', knowledge: ['s2'], emotional: 'calm' }),
    );
    assert.ok(
      warnings.some(w => w.includes('addCharacter') && w.includes('Alice')),
      `expected duplicate-name warning; got: ${JSON.stringify(warnings)}`,
    );
    // Confirm the second add did overwrite (silent-overwrite behavior is preserved
    // because the LLM may legitimately re-state characters).
    assert.deepEqual(state.characters.Alice.knowledge, ['s2']);
  });

  test('addCharacter is silent on first-time add', async () => {
    const { createState, addCharacter } = await import('../src/drama-state.js');
    const state = createState();
    const warnings = captureWarn(() =>
      addCharacter(state, { name: 'Bob', status: 'alive', location: 'street', knowledge: [], emotional: 'tense' }),
    );
    assert.equal(warnings.length, 0, 'first-time add should not warn');
  });

  test('addItem warns on duplicate name', async () => {
    const { createState, addItem } = await import('../src/drama-state.js');
    const state = createState();
    addItem(state, { name: 'Sword', status: 'sharp', holder: null, location: 'armory' });
    const warnings = captureWarn(() =>
      addItem(state, { name: 'Sword', status: 'broken', holder: null, location: 'armory' }),
    );
    assert.ok(warnings.some(w => w.includes('addItem') && w.includes('Sword')));
  });

  test('addLocation warns on duplicate name', async () => {
    const { createState, addLocation } = await import('../src/drama-state.js');
    const state = createState();
    addLocation(state, { name: 'Forest', status: 'open' });
    const warnings = captureWarn(() =>
      addLocation(state, { name: 'Forest', status: 'destroyed' }),
    );
    assert.ok(warnings.some(w => w.includes('addLocation') && w.includes('Forest')));
  });

  test('addRevelation warns on duplicate id (markRevealed is non-deterministic with dups)', async () => {
    const { createState, addRevelation } = await import('../src/drama-state.js');
    const state = createState();
    addRevelation(state, { id: 'r1', info: 'first', visibility: 'public', revealInClip: 0 });
    const warnings = captureWarn(() =>
      addRevelation(state, { id: 'r1', info: 'second', visibility: 'public', revealInClip: 1 }),
    );
    assert.ok(warnings.some(w => w.includes('addRevelation') && w.includes('r1')));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// R3 Fix #3 — websearch percentDecode handles literal non-ASCII (incl. surrogate
// pairs) without UTF-8 corruption. The prior implementation pushed
// charCodeAt(i) which produced invalid UTF-8 for any literal non-ASCII char.
// ──────────────────────────────────────────────────────────────────────────────
describe('R3 Fix #3 — percentDecode UTF-8 safety', () => {
  test('handles ASCII unchanged', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    assert.equal(percentDecode('hello-world_123'), 'hello-world_123');
  });

  test('decodes percent-escaped UTF-8 (multi-byte chars)', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    // "café" — é is U+00E9, encoded as %C3%A9
    assert.equal(percentDecode('caf%C3%A9'), 'café');
    // Chinese: "中" is U+4E2D, encoded as %E4%B8%AD
    assert.equal(percentDecode('%E4%B8%AD'), '中');
  });

  test('preserves literal non-ASCII chars without corruption', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    // Literal é (U+00E9, single UTF-16 code unit). Old code pushed 0xE9
    // directly — invalid UTF-8 → replacement char. New code emits 0xC3 0xA9.
    assert.equal(percentDecode('café'), 'café');
    // Literal Chinese — single UTF-16 code units in BMP.
    assert.equal(percentDecode('中文'), '中文');
  });

  test('handles surrogate pairs (Plane 1+ code points like emoji)', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    // 😀 is U+1F600 — surrogate pair in UTF-16 (D83D DE00). Old code would
    // push the surrogate halves as separate bytes → mojibake. New code uses
    // codePointAt + advances by 2 for non-BMP chars.
    assert.equal(percentDecode('hi 😀!'), 'hi 😀!');
  });

  test('decodes plus sign as space', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    assert.equal(percentDecode('hello+world'), 'hello world');
  });

  test('preserves malformed percent escape literally', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    // %ZZ is not a valid hex escape; should pass through as-is.
    assert.equal(percentDecode('%ZZ'), '%ZZ');
  });

  test('handles mix of percent-encoded and literal multi-byte chars', async () => {
    const { percentDecode } = await import('../src/websearch.js');
    // "中文" (literal) + "%20" (space) + "café" (literal with accent)
    assert.equal(percentDecode('中文%20café'), '中文 café');
  });
});
