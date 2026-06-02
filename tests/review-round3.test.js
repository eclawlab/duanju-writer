import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression tests for round-3 codebase-review findings.

// ── HIGH: loadConfigFrom shallow-copied DEFAULTS.providers, so any provider not
//    overridden by the user stayed the SAME object as DEFAULTS. applyEnvOverrides
//    then mutated it in place — baking env secrets into the process-wide DEFAULTS
//    and persisting them to config.json on the next load→save.
describe('round3 — config does not share or mutate DEFAULTS providers', () => {
  test('two loads return independent provider objects', async () => {
    const { loadConfigFrom } = await import('../src/config.js');
    const c1 = loadConfigFrom('/nonexistent-r3-a');
    const c2 = loadConfigFrom('/nonexistent-r3-b');
    assert.notEqual(c1.providers.openai, c2.providers.openai,
      'each load must get its own provider objects (no shared DEFAULTS ref)');
    c1.providers.openai.model = 'MUTATED';
    assert.notEqual(c2.providers.openai.model, 'MUTATED',
      'mutating one load must not leak into another');
  });

  test('an env-injected secret is not persisted into DEFAULTS / a later default load', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-round3-secret';
    let withEnv, withoutEnv;
    try {
      const { loadConfigFrom } = await import('../src/config.js');
      withEnv = loadConfigFrom('/nonexistent-r3-c').providers.openai.apiKey;
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
    }
    // A later load WITHOUT the env var must not still see the secret.
    const { loadConfigFrom } = await import('../src/config.js');
    withoutEnv = loadConfigFrom('/nonexistent-r3-d').providers.openai.apiKey;
    assert.equal(withEnv, 'sk-round3-secret', 'env override applies during the load that has it');
    assert.equal(withoutEnv, '', 'env secret must NOT persist into DEFAULTS for later loads');
  });
});

// ── HIGH: cn-chapter regex only allowed ASCII space/tab between 第N章 and the
//    title, so the standard typeset separator (full-width space U+3000) was not
//    matched and the whole novel collapsed to fixed windowed chunks.
describe('round3 — splitChapters handles full-width-space chapter headings', () => {
  test('第一章　归来 (U+3000) splits into real chapters', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一章　归来\n陆衡推开大门。\n\n第二章　重逢\n苏晚抬起头。\n\n第三章　决裂\n两人对视。';
    const chunks = splitChapters(text);
    assert.equal(chunks.length, 3, 'three full-width-separated chapters must split into 3');
    assert.equal(chunks[0].title, '归来', 'title after the full-width space must be captured');
  });

  test('ASCII-space headings still work (no regression)', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const chunks = splitChapters('第一章 归来\n甲。\n\n第二章 重逢\n乙。');
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].title, '归来');
  });
});

// ── LOW: `config set style <number>` coerced the value to a Number, then
//    getStyle(number).toLowerCase() threw an uncaught TypeError (exit 0 instead
//    of a clean "Unknown style" error). Guard: getStyle must tolerate / the CLI
//    must stringify. Test getStyle directly since that's where the crash was.
describe('round3 — getStyle tolerates a non-string key', () => {
  test('getStyle(number) throws a clean Error, not a TypeError', async () => {
    const { getStyle } = await import('../src/styles.js');
    assert.throws(() => getStyle(123), (err) => {
      assert.ok(!/toLowerCase is not a function/.test(err.message),
        'must not be a raw TypeError from .toLowerCase on a number');
      return err instanceof Error;
    });
  });
});

// ── LOW: result__snippet regex used (.*?) without the s-flag, dropping any
//    snippet whose text spans a newline.
describe('round3 — DuckDuckGo snippet parsing handles multiline snippets', () => {
  test('a snippet containing a newline is still captured', async () => {
    const { parseDuckDuckGoResults } = await import('../src/websearch.js');
    const html = [
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example">Title A</a>',
      '<div class="result__snippet">first line\nsecond line</div>',
    ].join('\n');
    const rows = parseDuckDuckGoResults(html, 10);
    const a = rows.find(r => r.title === 'Title A');
    assert.ok(a, 'result parsed');
    assert.ok(a.snippet && /first line/.test(a.snippet) && /second line/.test(a.snippet),
      'multiline snippet must be captured');
  });
});

// ── MEDIUM: scene enrichment updated scene.content but left the per-beat fields
//    (setting/action/dialogue/hook) stale; the uploader sends BOTH, so consumers
//    that read beats render the un-enriched text. After enrichment, content must
//    be the single source of truth (beats cleared). Tested via the exported
//    reconcile helper.
describe('round3 — enriched scene does not keep stale per-beat fields', () => {
  test('reconcileEnrichedScene clears beats so only content is authoritative', async () => {
    const mod = await import('../src/drama-writer.js');
    assert.equal(typeof mod.reconcileEnrichedScene, 'function',
      'drama-writer must export reconcileEnrichedScene');
    const scene = {
      content: 'EXPANDED long content',
      setting: 'short setting', action: 'short action',
      dialogue: 'short dialogue', hook: 'short hook',
    };
    const out = mod.reconcileEnrichedScene(scene);
    assert.equal(out.content, 'EXPANDED long content', 'content preserved');
    assert.equal(out.setting, undefined, 'stale setting cleared');
    assert.equal(out.action, undefined, 'stale action cleared');
    assert.equal(out.dialogue, undefined, 'stale dialogue cleared');
    assert.equal(out.hook, undefined, 'stale hook cleared');
  });
});
