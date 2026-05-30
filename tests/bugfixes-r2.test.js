import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const CHAR_MD = '# 林昭\nRole: Protagonist';
const EVENT_MD = '# Bridge Collapse\nThirty-seven dead.';

// (R2 Fix #1 retired: legacy buildRetryClipPrompt accepted constraints
// (genre/referenceCharacter/referenceEvent) for the scene-retry path. The
// duanju-pipeline buildRetryClipPrompt is intentionally simpler — it carries
// the parse-error feedback + clip schema constraints; trope/genre/reference
// material are injected upstream via buildClipPrompt's tropeSection /
// referenceCharacter / referenceEvent ctx fields, and don't need to be
// re-injected on retry.)

// ──────────────────────────────────────────────────────────────────────────────
// Round-2 Fix #2/#3: variantPlan failure no longer persists basePlan fallback
// to disk (would poison retries + commit wrong-ending plan to variant artifact).
// ──────────────────────────────────────────────────────────────────────────────
// NOTE: the per-variant logic moved from worker.js to src/variant-generator.js
// (generateVariant extraction). Behavior is unchanged; these source-inspection
// tests follow the code to its new home.
describe('R2 Fix #2/#3 — variantPlan persistence guard', () => {
  test('variant-generator gates variant plan saveArtifact on success', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/variant-generator.js', import.meta.url), 'utf8');
    // The variant plan save must be gated on a success flag, mirroring Fix #3 for basePlan.
    assert.ok(
      src.includes('if (variantPlanSucceeded) saveArtifact'),
      'variant plan save must be gated on variantPlanSucceeded flag',
    );
  });

  test('variant-generator falls back to empty skeleton on variant-plan failure (NOT basePlan)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/variant-generator.js', import.meta.url), 'utf8');
    // Audit Bug #7: basePlan was generated for the original outline (different
    // ending). Reusing it for a variant feeds wrong-ending sceneMap entries
    // into the variant's tail clips. Variant must fall back to empty skeleton.
    assert.ok(
      !/variant.*planning failed[^]*variantPlan = basePlan/.test(src),
      'variant plan failure must NOT fall back to basePlan (would feed wrong-ending sceneMap)',
    );
    assert.ok(
      /variant.*planning failed[^]*variantPlan = \{ clips: \[\]/.test(src),
      'variant plan failure should fall back to an empty skeleton',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round-2 Fix #4: JSON-repair invocations now log so users see when LLM JSON
// malformation triggers an extra repair LLM call.
// ──────────────────────────────────────────────────────────────────────────────
describe('R2 Fix #4 — JSON repair is observable', () => {
  // repairJson was consolidated into the shared src/json.js module (used by
  // drama-writer, collector, and the other pipeline stages). The observable
  // 'json-repair' log lives there now.
  test('json.js repairJson logs invocation', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/json.js', import.meta.url), 'utf8');
    const fnMatch = src.match(/export async function repairJson\([^]*?\n\}/);
    assert.ok(fnMatch, 'json.js repairJson should be defined');
    assert.ok(fnMatch[0].includes('json-repair'), 'json.js repairJson should log on invocation');
  });

  test('repairJson logs through chalk.dim with the json-repair tag', async () => {
    const { repairJson } = await import('../src/json.js');
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      await repairJson('{bad', 'demo', async () => '{"ok":1}');
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some((l) => l.includes('json-repair')), 'repair pass should emit a json-repair log');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round-2 Fix #5: vectorstore.load now logs corruption instead of silently
// returning an empty store.
// ──────────────────────────────────────────────────────────────────────────────
describe('R2 Fix #5 — vectorstore.load logs corruption', () => {
  test('vectorstore.load warns on corrupt JSON', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createStore } = await import('../src/vectorstore.js');

    const dir = mkdtempSync(join(tmpdir(), 'sw-vs-'));
    const filePath = join(dir, 'corrupt.json');
    writeFileSync(filePath, '{ "entries": [bad json !!!');

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const store = createStore(filePath);
      store.load();
      assert.ok(
        warnings.some(w => w.includes('vectorstore') && w.includes('corrupt.json')),
        `expected a [vectorstore] warning naming the corrupt file; got: ${JSON.stringify(warnings)}`,
      );
      // Store must still be usable after corruption — empty rather than crashed.
      assert.equal(store.size(), 0, 'corrupt store should fall back to empty');
    } finally {
      console.warn = origWarn;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('vectorstore.load is silent on missing file (not corrupt)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createStore } = await import('../src/vectorstore.js');

    const dir = mkdtempSync(join(tmpdir(), 'sw-vs-'));
    const filePath = join(dir, 'never-existed.json');

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));

    try {
      const store = createStore(filePath);
      store.load();
      assert.equal(warnings.length, 0, 'missing file should not produce a warning');
    } finally {
      console.warn = origWarn;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round-2 Fix #6: llm.js token accumulator coerces non-numeric usage values
// so non-conformant providers can't pollute stats with NaN / string concat.
// ──────────────────────────────────────────────────────────────────────────────
describe('R2 Fix #6 — token accumulator is type-safe', () => {
  test('OpenAI adapter source uses Number.isFinite guard for token coercion', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/llm.js', import.meta.url), 'utf8');
    // Look for the OpenAI block: usage handling must use Number() + isFinite guard.
    const openaiMatch = src.match(/if \(data\.usage\) \{[^]*?\n\s{6}\}/);
    assert.ok(openaiMatch, 'OpenAI usage block should exist');
    assert.ok(openaiMatch[0].includes('Number(data.usage.prompt_tokens)'), 'should coerce prompt_tokens');
    assert.ok(openaiMatch[0].includes('Number(data.usage.completion_tokens)'), 'should coerce completion_tokens');
    assert.ok(openaiMatch[0].includes('Number.isFinite'), 'should gate accumulation on isFinite');
  });

  test('Claude CLI adapter source uses Number coercion for cost/tokens', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/llm.js', import.meta.url), 'utf8');
    assert.ok(src.includes('Number(parsed.cost_usd)'), 'should coerce cost_usd');
    assert.ok(src.includes('Number(parsed.num_input_tokens)'), 'should coerce num_input_tokens');
    assert.ok(src.includes('Number(parsed.num_output_tokens)'), 'should coerce num_output_tokens');
  });

  test('resetLLMStats restarts cleanly', async () => {
    const { resetLLMStats, getLLMStats } = await import('../src/llm.js');
    resetLLMStats();
    const s = getLLMStats();
    assert.equal(s.inputTokens, 0);
    assert.equal(s.outputTokens, 0);
    assert.equal(s.calls, 0);
    assert.equal(s.totalMs, 0);
    assert.equal(s.costUsd, 0);
  });
});
