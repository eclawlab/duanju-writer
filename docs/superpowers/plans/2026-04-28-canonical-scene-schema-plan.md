# Canonical Scene Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the `duanju-copier` so its in-memory drama, on-disk artifacts, and wire payload all use the server-canonical "scene-with-content" shape, with the four-beat clip data preserved on a non-enumerable `_beats` ride-along that the compressor and consistency check read.

**Architecture:** One translation point inside `parseClip`. After parseClip, no other code in the writer ever reads `clip.setting/action/dialogue/hook` directly — they read `clip._beats.X`. The uploader stops translating; it forwards what's already shaped correctly. Server is unchanged.

**Tech Stack:** Node.js (>=20), `node:test` runner, ES modules. No external test/validation libraries.

**Spec:** [`docs/superpowers/specs/2026-04-28-canonical-scene-schema-design.md`](../specs/2026-04-28-canonical-scene-schema-design.md)

---

## File Structure

| File | Responsibility | Change Type |
|---|---|---|
| `src/constants.js` | Schema version constant | Bump `SCHEMA_VERSION` 2→3 |
| `src/drama-writer.js` | LLM clip generation + parsing | Add `composeScene`, `ENDING_LABEL_TO_ENUM`, `STORY_END` mapping; reshape `parseClip` and `buildFallbackClip` output; rename `episode.clips` → `episode.scenes` at all call sites |
| `src/consistency.js` | Hook-density check | Traverse `episode.scenes`; read `scene._beats.hook` |
| `src/compressor.js` | Clip-body rendering for digest prompt | `clipBody()` reads `c._beats` first, then falls back to direct fields (legacy) and `content` (legacy-legacy) |
| `src/uploader.js` | Wire payload construction | Drop translator; forward scene-shaped episodes; merge `genre→genres`, `trope→tags`; remove `format`/`lang`/`characters`/`episode.isEnding`/`episode.ending`/body `idempotencyKey` |
| `src/worker.js` | Pipeline orchestration | Rename `ep.clips` → `ep.scenes` at counter/traversal sites |
| `tests/constants.test.js` | Constants tests | Bump expected `SCHEMA_VERSION` to 3 |
| `tests/drama-writer.test.js` | Drama-writer tests | New tests for `composeScene`, `ENDING_LABEL_TO_ENUM`, reshaped `parseClip`/`buildFallbackClip` |
| `tests/consistency.test.js` | Consistency tests | Existing tests rewritten to use scene shape with `_beats` |
| `tests/compressor.test.js` | Compressor tests | New test asserting `_beats` is preferred over direct fields |
| `tests/uploader.test.js` | Uploader tests | Existing duanju-shape tests rewritten to assert canonical wire shape |
| `tests/integration-server-contract.test.js` | (NEW) End-to-end contract | Posts a hand-crafted scene-shaped drama against a running `../duanju` server; gated on `DUANJU_SERVER_URL` + `DUANJU_API_KEY` env vars |

Files **not changed** (intentionally): `src/planner.js`, `src/drama-state.js`, `src/snowflake.js`, all of `prompts/*.md`. The clip→scene shape change happens *after* generation, on validated LLM output. The planner and drama-state still operate on clip-grained plans.

---

## Task 1: Bump SCHEMA_VERSION to 3

**Files:**
- Modify: `src/constants.js:5`
- Modify: `tests/constants.test.js:14`

**Why:** Existing artifact loader (`src/worker.js:56-57`) refuses artifacts with stale `schemaVersion`. Bumping forces in-flight jobs to regenerate from scratch, avoiding the silent-garbage failure mode where a v2 artifact (with `episodes[].clips[]`) is loaded into v3 code (which expects `episodes[].scenes[]`).

- [ ] **Step 1: Update the test to expect SCHEMA_VERSION = 3**

Edit `tests/constants.test.js`, line 14:

```js
    assert.equal(SCHEMA_VERSION, 3);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/constants.test.js`
Expected: FAIL with `AssertionError: expected 2 to equal 3` (or similar).

- [ ] **Step 3: Bump the constant**

Edit `src/constants.js`, line 5:

```js
export const SCHEMA_VERSION = 3;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/constants.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/constants.js tests/constants.test.js
git commit -m "chore: bump SCHEMA_VERSION to 3 for canonical-scene pivot"
```

---

## Task 2: Add `composeScene` helper and `ENDING_LABEL_TO_ENUM` to drama-writer.js

**Files:**
- Modify: `src/drama-writer.js` (add two named exports near the existing `VALID_ENDINGS` constant on line 134)
- Modify: `tests/drama-writer.test.js` (append a new `describe('composeScene', ...)` and `describe('ENDING_LABEL_TO_ENUM', ...)` block)

**Why:** Both pieces are small, pure, and used by the next two tasks (`parseClip` reshape, `buildFallbackClip` reshape). Adding them first means the next two tasks can import existing exports rather than coupling implementation order.

- [ ] **Step 1: Write the failing tests**

Append to `tests/drama-writer.test.js`:

```js
describe('composeScene', () => {
  test('joins setting / action / dialogue / hook into block-format content', async () => {
    const { composeScene } = await import('../src/drama-writer.js');
    const content = composeScene({
      setting: '夜雨破庙',
      action: '陆衡踉跄推门',
      dialogue: '[narrator]\n气氛凝重\n[character:陆衡]\n三年了',
      hook: '身后传来摩托引擎声',
    });
    assert.equal(
      content,
      '[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门\n\n[narrator]\n气氛凝重\n[character:陆衡]\n三年了\n\n[narrator]\n身后传来摩托引擎声'
    );
  });

  test('omits the setting block when setting is empty', async () => {
    const { composeScene } = await import('../src/drama-writer.js');
    const content = composeScene({
      setting: '',
      action: '陆衡推门',
      dialogue: '[narrator]\n气氛凝重',
      hook: '钩点',
    });
    assert.equal(content, '[narrator]\n陆衡推门\n\n[narrator]\n气氛凝重\n\n[narrator]\n钩点');
  });

  test('omits the hook block when hook is empty (conclusion clip)', async () => {
    const { composeScene } = await import('../src/drama-writer.js');
    const content = composeScene({
      setting: '终幕',
      action: '灯熄',
      dialogue: '[character:陆衡]\n这局我赢',
      hook: '',
    });
    assert.equal(content, '[narrator]\n终幕\n\n[narrator]\n灯熄\n\n[character:陆衡]\n这局我赢');
  });

  test('throws when composition would produce empty content', async () => {
    const { composeScene } = await import('../src/drama-writer.js');
    assert.throws(
      () => composeScene({ setting: '', action: '', dialogue: '', hook: '' }),
      /empty content/
    );
  });
});

describe('ENDING_LABEL_TO_ENUM', () => {
  test('maps 爽爆 to GOOD', async () => {
    const { ENDING_LABEL_TO_ENUM } = await import('../src/drama-writer.js');
    assert.equal(ENDING_LABEL_TO_ENUM['爽爆'], 'GOOD');
  });
  test('maps 苦尽甘来 to NEUTRAL', async () => {
    const { ENDING_LABEL_TO_ENUM } = await import('../src/drama-writer.js');
    assert.equal(ENDING_LABEL_TO_ENUM['苦尽甘来'], 'NEUTRAL');
  });
  test('maps 反转 to SPECIAL', async () => {
    const { ENDING_LABEL_TO_ENUM } = await import('../src/drama-writer.js');
    assert.equal(ENDING_LABEL_TO_ENUM['反转'], 'SPECIAL');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/drama-writer.test.js`
Expected: FAIL — both `composeScene` and `ENDING_LABEL_TO_ENUM` are undefined imports.

- [ ] **Step 3: Add the two exports to `src/drama-writer.js`**

Insert immediately after the existing `export const VALID_ENDINGS = [...]` line (around line 134):

```js
export const ENDING_LABEL_TO_ENUM = {
  '爽爆':   'GOOD',     // unambiguous win
  '苦尽甘来': 'NEUTRAL',  // bittersweet-but-positive
  '反转':   'SPECIAL',  // final twist outside the standard taxonomy
};

/**
 * Compose four-beat clip data into a single block-format `content` string.
 * Each non-empty beat becomes a [narrator] block (dialogue is inserted verbatim
 * because the LLM emits it pre-formatted with [narrator]/[character:Name] tags).
 * Blocks are separated by a blank line. Throws if all beats are empty.
 */
export function composeScene({ setting, action, dialogue, hook }) {
  const blocks = [];
  if (setting && setting.trim()) blocks.push(`[narrator]\n${setting}`);
  if (action  && action.trim())  blocks.push(`[narrator]\n${action}`);
  if (dialogue && dialogue.trim()) blocks.push(dialogue);
  if (hook    && hook.trim())    blocks.push(`[narrator]\n${hook}`);
  if (blocks.length === 0) throw new Error('composeScene: empty content (all beats were empty)');
  return blocks.join('\n\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/drama-writer.test.js`
Expected: PASS for the new `composeScene` and `ENDING_LABEL_TO_ENUM` describe blocks. (Other drama-writer tests should also still pass — none touch parseClip output shape yet.)

- [ ] **Step 5: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: add composeScene and ENDING_LABEL_TO_ENUM in drama-writer"
```

---

## Task 3: Reshape `parseClip` to return scene-shaped output with non-enumerable `_beats`

**Files:**
- Modify: `src/drama-writer.js:466-514` (the `parseClip` function)
- Modify: `tests/drama-writer.test.js` (add a new `describe('parseClip — scene shape', ...)` block)

**Why:** This is the core architectural change. After parseClip returns, the rest of the writer pipeline only sees scene-shaped objects. The four beats survive on a non-enumerable `_beats` field that compressor/consistency consult.

- [ ] **Step 1: Write the failing tests**

Append to `tests/drama-writer.test.js`:

```js
describe('parseClip — scene shape', () => {
  function rawClip(overrides = {}) {
    return JSON.stringify({
      clipIndex: 0,
      setting: '夜雨破庙',
      action: '陆衡踉跄推门',
      dialogue: '[character:陆衡]\n三年了',
      hook: '摩托声渐近',
      durationSec: 12,
      isConclusion: false,
      conclusion: null,
      ...overrides,
    });
  }

  test('returns { content, choices, conclusion } shape (no top-level beats)', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip());
    assert.equal(typeof scene.content, 'string');
    assert.ok(scene.content.length > 0);
    assert.deepEqual(scene.choices, []);
    assert.equal(scene.conclusion, null);
    // Top-level beat fields should NOT be enumerable on the returned object
    const enumerableKeys = Object.keys(scene);
    assert.ok(!enumerableKeys.includes('setting'), `setting should not be enumerable, got keys: ${enumerableKeys}`);
    assert.ok(!enumerableKeys.includes('action'), 'action should not be enumerable');
    assert.ok(!enumerableKeys.includes('dialogue'), 'dialogue should not be enumerable');
    assert.ok(!enumerableKeys.includes('hook'), 'hook should not be enumerable');
  });

  test('JSON.stringify(scene) does not leak _beats or beat fields', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip());
    const json = JSON.stringify(scene);
    assert.ok(!json.includes('"setting"'), `setting leaked into JSON: ${json}`);
    assert.ok(!json.includes('"_beats"'), `_beats leaked into JSON: ${json}`);
    assert.ok(!json.includes('"hook"'), `hook leaked into JSON: ${json}`);
    assert.ok(!json.includes('"action"'), `action leaked into JSON: ${json}`);
  });

  test('_beats ride-along contains the original four beats plus durationSec/clipIndex/isConclusion', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip());
    assert.equal(scene._beats.setting, '夜雨破庙');
    assert.equal(scene._beats.action, '陆衡踉跄推门');
    assert.equal(scene._beats.dialogue, '[character:陆衡]\n三年了');
    assert.equal(scene._beats.hook, '摩托声渐近');
    assert.equal(scene._beats.durationSec, 12);
    assert.equal(scene._beats.clipIndex, 0);
    assert.equal(scene._beats.isConclusion, false);
  });

  test('content is composed from beats per the composition rule', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip());
    assert.equal(
      scene.content,
      '[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门\n\n[character:陆衡]\n三年了\n\n[narrator]\n摩托声渐近'
    );
  });

  test('conclusion clip with 爽爆 → conclusion.ending GOOD, type STORY_END', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip({
      isConclusion: true,
      hook: '',
      conclusion: { title: '结局：碾压', overview: '反派全员跪地', type: 'DRAMA_END', ending: '爽爆' },
    }));
    assert.equal(scene.conclusion.type, 'STORY_END');
    assert.equal(scene.conclusion.ending, 'GOOD');
    assert.equal(scene.conclusion.title, '结局：碾压');
    assert.equal(scene.conclusion.overview, '反派全员跪地');
  });

  test('conclusion clip with 苦尽甘来 → NEUTRAL', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip({
      isConclusion: true,
      hook: '',
      conclusion: { title: 't', overview: 'o', type: 'DRAMA_END', ending: '苦尽甘来' },
    }));
    assert.equal(scene.conclusion.ending, 'NEUTRAL');
  });

  test('conclusion clip with 反转 → SPECIAL', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const scene = await parseClip(rawClip({
      isConclusion: true,
      hook: '',
      conclusion: { title: 't', overview: 'o', type: 'DRAMA_END', ending: '反转' },
    }));
    assert.equal(scene.conclusion.ending, 'SPECIAL');
  });

  test('still throws on missing dialogue (existing per-beat validation runs first)', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    await assert.rejects(
      () => parseClip(rawClip({ dialogue: '' })),
      /clip missing dialogue/
    );
  });

  test('still throws on dialogue exceeding CN-char limit (60)', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const long = '一'.repeat(70);
    await assert.rejects(
      () => parseClip(rawClip({ dialogue: long })),
      /dialogue.*max 60/
    );
  });

  test('still throws on missing hook for non-conclusion clip', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    await assert.rejects(
      () => parseClip(rawClip({ hook: '' })),
      /hook required/
    );
  });

  test('still throws on conclusion clip with invalid ending label', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    await assert.rejects(
      () => parseClip(rawClip({
        isConclusion: true,
        hook: '',
        conclusion: { title: 't', overview: 'o', type: 'DRAMA_END', ending: 'BE' },
      })),
      /ending must be one of/
    );
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/drama-writer.test.js`
Expected: the new `parseClip — scene shape` tests fail because `parseClip` still returns the old `{ setting, action, dialogue, hook, ... }` shape. Existing parseClip tests should still pass.

- [ ] **Step 3: Reshape `parseClip` to return scene shape with non-enumerable `_beats`**

Replace the body of `parseClip` in `src/drama-writer.js` (currently lines 466-514) so that, after the existing validation block and conclusion validation, it composes a scene object. The new ending of the function (replace the final `return data;` and everything from the `if (data.isConclusion) {...}` block onward) should look like:

```js
  // Conclusion validation.
  let composedConclusion = null;
  if (data.isConclusion) {
    if (!data.conclusion || typeof data.conclusion !== 'object') {
      throw new Error('conclusion clip must have a conclusion object');
    }
    if (data.conclusion.type !== 'DRAMA_END') {
      throw new Error(`conclusion.type must be 'DRAMA_END', got: ${data.conclusion.type}`);
    }
    if (!VALID_ENDINGS.includes(data.conclusion.ending)) {
      throw new Error(`conclusion.ending must be one of ${VALID_ENDINGS.join('/')}, got: ${data.conclusion.ending}`);
    }
    composedConclusion = {
      title: data.conclusion.title,
      overview: data.conclusion.overview,
      type: 'STORY_END',
      ending: ENDING_LABEL_TO_ENUM[data.conclusion.ending],
    };
  }

  // Default durationSec if missing/out-of-range.
  if (typeof data.durationSec !== 'number' || data.durationSec < 6 || data.durationSec > 20) {
    data.durationSec = 12;
  }

  // Compose scene-shaped output. Beats survive on a non-enumerable _beats
  // ride-along that the compressor and consistency check consult; nothing
  // else in the pipeline reads beat fields directly.
  const content = composeScene({
    setting: data.setting,
    action: data.action,
    dialogue: data.dialogue,
    hook: data.hook,
  });
  const scene = { content, choices: [], conclusion: composedConclusion };
  Object.defineProperty(scene, '_beats', {
    value: {
      clipIndex: data.clipIndex,
      setting: data.setting,
      action: data.action,
      dialogue: data.dialogue,
      hook: data.hook,
      durationSec: data.durationSec,
      isConclusion: !!data.isConclusion,
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return scene;
}
```

- [ ] **Step 4: Run all drama-writer tests to verify they pass**

Run: `node --test tests/drama-writer.test.js`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: parseClip returns scene-shaped output with non-enumerable _beats"
```

---

## Task 4: Reshape `buildFallbackClip` to return the same scene shape

**Files:**
- Modify: `src/drama-writer.js:548-583` (the `buildFallbackClip` function)
- Modify: `tests/drama-writer.test.js` (add a `describe('buildFallbackClip — scene shape', ...)` block)

**Why:** Fallback output must match parseClip output exactly, otherwise `episode.scenes.push(scene)` produces a heterogeneous array (some entries scene-shaped, some clip-shaped) and downstream code breaks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/drama-writer.test.js`:

```js
describe('buildFallbackClip — scene shape', () => {
  test('non-conclusion fallback returns scene shape', async () => {
    const { buildFallbackClip } = await import('../src/drama-writer.js');
    const scene = buildFallbackClip({ clipIndex: 5, summary: '陆衡推门', isConclusion: false });
    assert.equal(typeof scene.content, 'string');
    assert.ok(scene.content.length > 0);
    assert.deepEqual(scene.choices, []);
    assert.equal(scene.conclusion, null);
    // No enumerable beat fields
    const keys = Object.keys(scene);
    assert.ok(!keys.includes('setting'), 'fallback leaks setting');
    assert.ok(!keys.includes('hook'), 'fallback leaks hook');
  });

  test('conclusion fallback maps 爽爆 to GOOD and type STORY_END', async () => {
    const { buildFallbackClip } = await import('../src/drama-writer.js');
    const scene = buildFallbackClip({ clipIndex: 9, summary: '终局', isConclusion: true, ending: '爽爆' });
    assert.equal(scene.conclusion.type, 'STORY_END');
    assert.equal(scene.conclusion.ending, 'GOOD');
  });

  test('fallback _beats survives on non-enumerable property', async () => {
    const { buildFallbackClip } = await import('../src/drama-writer.js');
    const scene = buildFallbackClip({ clipIndex: 3, summary: 'sx' });
    assert.equal(scene._beats.clipIndex, 3);
    assert.ok(typeof scene._beats.setting === 'string');
    assert.ok(typeof scene._beats.action === 'string');
    assert.ok(typeof scene._beats.dialogue === 'string');
  });

  test('fallback JSON.stringify does not leak _beats', async () => {
    const { buildFallbackClip } = await import('../src/drama-writer.js');
    const scene = buildFallbackClip({ clipIndex: 0, summary: 'x' });
    assert.ok(!JSON.stringify(scene).includes('_beats'));
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/drama-writer.test.js`
Expected: FAIL — `buildFallbackClip` still returns the old beat-shaped object.

- [ ] **Step 3: Reshape `buildFallbackClip`**

Replace `buildFallbackClip` in `src/drama-writer.js` (currently lines 548-583) with:

```js
export function buildFallbackClip(ctx = {}) {
  const {
    clipIndex = 0,
    summary = '',
    isConclusion = false,
    ending = '爽爆',
  } = ctx;
  const truncate = (s, n) => {
    const chars = (s || '').match(/[一-鿿㐀-䶿]/g) || [];
    return chars.slice(0, n).join('');
  };
  const setting  = '场景 · 时间 · 氛围';
  const action   = truncate(summary || '动作描述', 80) || '动作描述';
  const dialogue = '[narrator]\n' + (truncate(summary, 50) || '叙述');
  const hook     = isConclusion ? '' : '镜头特写关键道具';
  const durationSec = 12;

  const content = composeScene({ setting, action, dialogue, hook });
  let conclusion = null;
  if (isConclusion) {
    const safeEnding = VALID_ENDINGS.includes(ending) ? ending : '爽爆';
    conclusion = {
      title: '结局',
      overview: summary || '故事结束',
      type: 'STORY_END',
      ending: ENDING_LABEL_TO_ENUM[safeEnding],
    };
  }
  const scene = { content, choices: [], conclusion };
  Object.defineProperty(scene, '_beats', {
    value: { clipIndex, setting, action, dialogue, hook, durationSec, isConclusion: !!isConclusion },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return scene;
}
```

- [ ] **Step 4: Run all drama-writer tests to verify they pass**

Run: `node --test tests/drama-writer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: buildFallbackClip returns scene-shaped output matching parseClip"
```

---

## Task 5: Update `consistency.checkHookDensity` to traverse `episode.scenes` and read `_beats.hook`

**Files:**
- Modify: `src/consistency.js:12-21` (the entire `checkHookDensity` function)
- Modify: `tests/consistency.test.js` (rewrite all four tests)

**Why:** Episodes now carry `scenes`, not `clips`, and each scene's hook lives on `_beats.hook`. The check still serves as belt-and-suspenders for fallback-injected scenes that bypass parseClip's hook-required validation.

- [ ] **Step 1: Rewrite the existing tests to use scene shape with `_beats`**

Replace the entire body of `tests/consistency.test.js` with:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Test helper: build a scene-shaped object whose _beats matches what
// parseClip / buildFallbackClip would produce. Non-enumerable so the
// shape mirrors production exactly.
function makeScene({ clipIndex, hook, isConclusion = false }) {
  const scene = { content: 'x', choices: [], conclusion: null };
  Object.defineProperty(scene, '_beats', {
    value: { clipIndex, hook, isConclusion },
    enumerable: false,
  });
  return scene;
}

describe('consistency', () => {
  describe('hook density check', () => {
    test('detects scene missing hook on non-conclusion', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const episode = {
        episodeIndex: 0,
        isEnding: false,
        scenes: [
          makeScene({ clipIndex: 0, hook: '来电响起' }),
          makeScene({ clipIndex: 1, hook: '' }),
        ],
      };
      const issues = checkHookDensity(episode);
      assert.equal(issues.length, 1);
      assert.match(issues[0], /clip 1.*missing hook/);
    });

    test('allows empty hook on conclusion clip', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const episode = {
        episodeIndex: 0,
        isEnding: true,
        scenes: [
          makeScene({ clipIndex: 0, hook: '反派出现' }),
          makeScene({ clipIndex: 1, hook: '', isConclusion: true }),
        ],
      };
      assert.deepEqual(checkHookDensity(episode), []);
    });

    test('handles episode with no scenes', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      assert.deepEqual(checkHookDensity({ episodeIndex: 0, scenes: [] }), []);
      assert.deepEqual(checkHookDensity({ episodeIndex: 0 }), []);
    });

    test('flags whitespace-only hook as missing', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const issues = checkHookDensity({
        episodeIndex: 2,
        scenes: [makeScene({ clipIndex: 0, hook: '   ' })],
      });
      assert.equal(issues.length, 1);
      assert.match(issues[0], /clip 0 of episode 2 missing hook/);
    });
  });
});
```

- [ ] **Step 2: Run the rewritten tests to verify they fail**

Run: `node --test tests/consistency.test.js`
Expected: FAIL — `consistency.js` still iterates `episode.clips` and reads `clip.hook`.

- [ ] **Step 3: Update `src/consistency.js`**

Replace the entire `checkHookDensity` function (lines 12-21) with:

```js
export function checkHookDensity(episode) {
  const issues = [];
  for (const scene of episode.scenes || []) {
    const beats = scene._beats || {};
    if (beats.isConclusion) continue;
    if (!beats.hook || beats.hook.trim().length === 0) {
      issues.push(`clip ${beats.clipIndex} of episode ${episode.episodeIndex} missing hook`);
    }
  }
  return issues;
}
```

Also update the docstring comment immediately above (lines 1-11) to reference scenes/`_beats`:

```js
/**
 * Hook-density consistency check. Every non-conclusion scene in an episode
 * must end on a hook (recorded on the scene's non-enumerable _beats ride-along).
 * Returns an array of issue strings (empty when the episode is hook-clean).
 *
 * (parseClip already throws on missing hooks; this check exists as
 * belt-and-suspenders for fallback-injected scenes that bypass parseClip.)
 */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/consistency.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consistency.js tests/consistency.test.js
git commit -m "refactor: consistency reads scene._beats.hook on episode.scenes"
```

---

## Task 6: Update `compressor.clipBody` to read `_beats` first

**Files:**
- Modify: `src/compressor.js:25-33` (the `clipBody` helper)
- Modify: `tests/compressor.test.js` (add one new test asserting `_beats` priority)

**Why:** The compressor's prompt builder needs the four beats to produce useful digests. After parseClip, those beats live only on `_beats`. Existing fallback paths (legacy `{content}` shape, legacy direct fields) are kept for safety.

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('compressor', ...)` block in `tests/compressor.test.js` (read the file first to find the right insertion point — append before the closing `});` of the outer describe):

```js
test('buildCompressPrompt prefers _beats over direct fields', async () => {
  const { buildCompressPrompt } = await import('../src/compressor.js');
  const sceneWithBeats = { content: 'x' };
  Object.defineProperty(sceneWithBeats, '_beats', {
    value: { setting: '夜雨', action: '推门', dialogue: '[character:陆衡]\n三年了', hook: '钩点' },
    enumerable: false,
  });
  const prompt = buildCompressPrompt([sceneWithBeats], 'cn');
  // The composed body should contain all four beat fields, not the bare `content`.
  assert.ok(prompt.includes('场景：夜雨'), 'prompt missing setting from _beats');
  assert.ok(prompt.includes('动作：推门'), 'prompt missing action from _beats');
  assert.ok(prompt.includes('[character:陆衡]'), 'prompt missing dialogue from _beats');
  assert.ok(prompt.includes('钩点：钩点'), 'prompt missing hook from _beats');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/compressor.test.js`
Expected: FAIL — `clipBody` currently sees `c.content === 'x'` and returns that, never reaching the beat-rendering branch.

- [ ] **Step 3: Update `clipBody` in `src/compressor.js`**

Replace lines 23-33 with:

```js
// Render a clip's spoken/action content for LLM compression. Reads the
// non-enumerable _beats ride-along that parseClip / buildFallbackClip set.
// Falls back to direct fields (pre-pivot fallback shape) and to a flat
// `content` string (legacy audio-novel shape) so this helper degrades
// gracefully on artifacts produced by older code paths.
function clipBody(c) {
  const beats = c._beats || c;
  const parts = [];
  if (beats.setting)  parts.push(`场景：${beats.setting}`);
  if (beats.action)   parts.push(`动作：${beats.action}`);
  if (beats.dialogue) parts.push(beats.dialogue);
  if (beats.hook)     parts.push(`钩点：${beats.hook}`);
  if (parts.length > 0) return parts.join('\n');
  return c.content || '';
}
```

- [ ] **Step 4: Run all compressor tests to verify they pass**

Run: `node --test tests/compressor.test.js`
Expected: PASS for the new test. Existing legacy `{content}`-shape tests should also still pass (the `content || ''` fallback covers them).

- [ ] **Step 5: Commit**

```bash
git add src/compressor.js tests/compressor.test.js
git commit -m "refactor: compressor reads scene._beats first, falls back to content"
```

---

## Task 7: Rename `episode.clips` → `episode.scenes` throughout `src/drama-writer.js`

**Files:**
- Modify: `src/drama-writer.js` at lines 793, 1042, 1060, 1101 (and any other occurrences)
- Modify: `tests/drama-writer.test.js` (update any existing tests that assert on `episode.clips`)

**Why:** The episode object built by the drama-writer's main loop holds the array that downstream code traverses. Renaming the property — and only the property — is what makes the in-memory drama match the wire shape.

- [ ] **Step 1: Identify every occurrence**

Run: `grep -n "\.clips\b\|episode\.clips\|ep\.clips" src/drama-writer.js`
Expected: lines 793 (literal init), 1042 (push), 1060 (lastClip lookup), 1101 (validation). Also note line 694 (`plan.clips.length` — this is a *plan* field, not an episode field, do NOT rename).

- [ ] **Step 2: Rename in `src/drama-writer.js`**

Apply each of these edits:

Line 793 — replace:
```js
    const episode = { title: ep.title, episodeIndex: ep.episodeIndex, isEnding: !!ep.isEnding, ending: ep.ending || null, clips: [], episodeChoices: ep.episodeChoices || [] };
```
with:
```js
    const episode = { title: ep.title, episodeIndex: ep.episodeIndex, isEnding: !!ep.isEnding, ending: ep.ending || null, scenes: [], episodeChoices: ep.episodeChoices || [] };
```

Line 1042 — replace:
```js
      episode.clips.push(scene);
```
with:
```js
      episode.scenes.push(scene);
```

Line 1060 — replace:
```js
      const lastClip = episode.clips[episode.clips.length - 1];
```
with:
```js
      const lastClip = episode.scenes[episode.scenes.length - 1];
```

Line 1101 — replace:
```js
    if (!ep.clips.length) throw new Error(`Episode "${ep.title}" has no clips`);
```
with:
```js
    if (!ep.scenes.length) throw new Error(`Episode "${ep.title}" has no scenes`);
```

- [ ] **Step 3: Update any drama-writer tests that asserted on `episode.clips`**

Run: `grep -n "ep\.clips\|episode\.clips\|\\.clips\\.\\(length\\|push\\|\\[" tests/drama-writer.test.js`

If the grep produces matches, update each in-place to use `scenes`. (At time of writing, the existing drama-writer tests do not introspect episode shape directly — they cover prompt building / parseClip / buildFallbackClip. If grep is empty, skip this step.)

- [ ] **Step 4: Run all drama-writer tests to verify they pass**

Run: `node --test tests/drama-writer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "refactor: rename episode.clips → episode.scenes in drama-writer"
```

---

## Task 8: Rename `ep.clips` → `ep.scenes` and `sc.content` traversal in `src/worker.js`

**Files:**
- Modify: `src/worker.js:223, 232, 362, 364`

**Why:** The worker counts clip totals and word totals from the episode array. Without this rename it crashes (`Cannot read properties of undefined (reading 'reduce')`) the moment the new drama-writer hands it a scene-shaped object.

- [ ] **Step 1: Identify every occurrence**

Run: `grep -n "ep\.clips\|episode\.clips" src/worker.js`
Expected: lines 223, 232, 362, 364.

- [ ] **Step 2: Rename in `src/worker.js`**

Line 223 — replace:
```js
        globalClipIndex: frontStory.episodes.reduce((s, ep) => s + (ep.clips?.length || 0), 0),
```
with:
```js
        globalClipIndex: frontStory.episodes.reduce((s, ep) => s + (ep.scenes?.length || 0), 0),
```

Line 232 — replace:
```js
      const frontClipCount = frontProgress.episodes.reduce((s, ep) => s + (ep.clips?.length || 0), 0);
```
with:
```js
      const frontClipCount = frontProgress.episodes.reduce((s, ep) => s + (ep.scenes?.length || 0), 0);
```

Line 362 — replace:
```js
      const vClips = variantStory.episodes.reduce((sum, ep) => sum + (ep.clips?.length || 0), 0);
```
with:
```js
      const vClips = variantStory.episodes.reduce((sum, ep) => sum + (ep.scenes?.length || 0), 0);
```

Line 364 — replace:
```js
        (sum, ep) => sum + ep.clips.reduce((s, sc) => s + countWords(sc.content), 0), 0);
```
with:
```js
        (sum, ep) => sum + ep.scenes.reduce((s, sc) => s + countWords(sc.content), 0), 0);
```

(Note: `sc.content` was already correct — the writer's old shape had no `content` field, so `countWords(undefined)` was returning 0. After this rename, scenes really do have `content`, so word counts will start being non-zero. That's the intended behavior.)

- [ ] **Step 3: Run worker tests**

Run: `node --test tests/worker.test.js`
Expected: PASS. (If a worker test happens to introspect `ep.clips`, update it the same way — grep first: `grep -n "ep\.clips\|episode\.clips" tests/worker.test.js`.)

- [ ] **Step 4: Commit**

```bash
git add src/worker.js tests/worker.test.js
git commit -m "refactor: rename ep.clips → ep.scenes in worker counters"
```

---

## Task 9: Rewrite `uploader.buildRequest` to emit canonical wire shape

**Files:**
- Modify: `src/uploader.js:9-66` (the `buildRequest` function)
- Modify: `tests/uploader.test.js:167-224` (the `describe('duanju payload shape', ...)` block) plus add new tests

**Why:** Last-mile change. After this, the writer posts a payload that matches the server's typed body shape exactly — no `format`, no `lang`, no `characters`, no `episode.isEnding/ending`, no body `idempotencyKey`. `genre` (singular) is prepended to `genres[]`; `trope` is pushed into `tags[]`. `Idempotency-Key` header is retained.

- [ ] **Step 1: Rewrite the `duanju payload shape` describe block in `tests/uploader.test.js`**

Replace lines 167-224 of `tests/uploader.test.js` (the entire `describe('duanju payload shape', ...) { ... });`) with:

```js
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
```

(The existing tests above the `describe('duanju payload shape', ...)` block — basic URL/method/headers/publish/variation tests — stay as-is. They still pass against the new `buildRequest` because the URL/method/headers/publish/variation logic is preserved.)

- [ ] **Step 2: Run uploader tests to verify the new ones fail and the old ones still pass**

Run: `node --test tests/uploader.test.js`
Expected: the new `canonical scene wire shape` tests FAIL (current `buildRequest` still emits `clips`/`format`/`lang`/etc.). Existing URL/method/headers/publish/variation tests should still pass.

- [ ] **Step 3: Rewrite `buildRequest` in `src/uploader.js`**

Replace lines 9-66 (the `buildRequest` function) with:

```js
export function buildRequest(drama, config, variationOptions = {}) {
  const url = `${config.autostoryUrl}/api/ai/stories`;

  // Merge writer-only fields into the server's existing string-array columns:
  //   - `genre` (singular) prepends to `genres[]`
  //   - `trope` prepends to `tags[]`
  // .filter(Boolean) drops empty/missing values without throwing.
  const genres = [drama.genre, ...(drama.genres || [])].filter(Boolean);
  const tags   = [drama.trope, ...(drama.tags   || [])].filter(Boolean);

  const body = {
    title: drama.title,
    synopsis: drama.synopsis,
    genres,
    tags,
    episodes: (drama.episodes || []).map(ep => ({
      title: ep.title,
      episodeIndex: ep.episodeIndex,
      scenes: ep.scenes || [],
    })),
  };

  if (variationOptions.variationGroupId) body.variationGroupId = variationOptions.variationGroupId;
  if (variationOptions.variationLabel)   body.variationLabel   = variationOptions.variationLabel;
  if (config.publishOnUpload !== undefined) body.publish = config.publishOnUpload;

  const timeoutMs = Number.isFinite(config.uploadTimeout) && config.uploadTimeout > 0
    ? config.uploadTimeout
    : DEFAULT_UPLOAD_TIMEOUT_MS;

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': config.aiApiKey,
  };
  if (variationOptions.idempotencyKey) {
    // Standard idempotency mechanism. Server doesn't dedup today, but the header
    // is the agreed surface — body-level idempotencyKey was non-standard noise.
    headers['Idempotency-Key'] = variationOptions.idempotencyKey;
  }

  return {
    url,
    options: {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
    timeoutMs,
  };
}
```

- [ ] **Step 4: Run all uploader tests to verify they pass**

Run: `node --test tests/uploader.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/uploader.js tests/uploader.test.js
git commit -m "feat: uploader emits server-canonical scene wire shape"
```

---

## Task 10: Add gated end-to-end contract test against `../duanju`

**Files:**
- Create: `tests/integration-server-contract.test.js`

**Why:** Spec calls this load-bearing. Cross-repo test harness is awkward (writer is plain JS / `node:test`; server is TS / Vitest), so the test is gated on env vars: when `DUANJU_SERVER_URL` and `DUANJU_API_KEY` are present, it posts a real payload at the real server and asserts 201 + a `story.id`. When unset, the test skips with a clear message documenting how to run it.

- [ ] **Step 1: Create the integration test file**

Create `tests/integration-server-contract.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SERVER_URL = process.env.DUANJU_SERVER_URL;
const API_KEY    = process.env.DUANJU_API_KEY;

describe('server contract — end-to-end POST /api/ai/stories', () => {
  test('writer payload is accepted by ../duanju server (returns 201 + story.id)', { skip: !SERVER_URL || !API_KEY ? 'set DUANJU_SERVER_URL and DUANJU_API_KEY to run; see plan task 10' : false }, async () => {
    const { buildRequest } = await import('../src/uploader.js');

    // Hand-built drama in the post-Task-9 in-memory shape: episodes[].scenes[]
    // with composed content + structured conclusion. Mirrors what parseClip
    // would emit at the end of a real generation run.
    const drama = {
      title: '契约测试 · 战神归来',
      synopsis: '一句钩子，验证服务端契约',
      trope: '战神归来',
      genre: '都市',
      genres: ['复仇'],
      tags: ['打脸'],
      episodes: [
        {
          episodeIndex: 0,
          title: '第1集',
          scenes: [
            {
              content: '[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门\n\n[character:陆衡]\n三年了……该回去了\n\n[narrator]\n身后传来摩托声',
              choices: [],
              conclusion: null,
            },
          ],
        },
        {
          episodeIndex: 1,
          title: '终局',
          scenes: [
            {
              content: '[narrator]\n灯熄\n\n[character:陆衡]\n这局我赢',
              choices: [],
              conclusion: { title: '结局', overview: '反派全员跪地', type: 'STORY_END', ending: 'GOOD' },
            },
          ],
        },
      ],
    };

    const config = { autostoryUrl: SERVER_URL, aiApiKey: API_KEY };
    const { url, options } = buildRequest(drama, config, {
      variationGroupId: `contract-test-${Date.now()}`,
      variationLabel: '爽爆',
      idempotencyKey: `contract-test-${Date.now()}`,
    });

    const res = await fetch(url, options);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${text.slice(0, 500)}`);
    assert.ok(body && body.story && body.story.id, `response missing story.id: ${text.slice(0, 500)}`);
    assert.ok(Array.isArray(body.episodes), 'response missing episodes array');
    assert.equal(body.episodes.length, 2, 'expected 2 episodes in response');
    assert.equal(body.episodes[1].scenes[0].hasConclusion, true, 'final scene should have a conclusion');
  });
});
```

- [ ] **Step 2: Run the test with no env vars to verify it skips cleanly**

Run: `node --test tests/integration-server-contract.test.js`
Expected: the test is skipped, with the message `set DUANJU_SERVER_URL and DUANJU_API_KEY to run; see plan task 10` printed in the output. No failures.

- [ ] **Step 3: Run the test against a real server to verify it passes**

In one terminal, start the duanju server with an in-memory DB:

```bash
cd /Users/boclaw/Project/duanju
DB_PATH=:memory: npm run dev:api
```

In another terminal, bootstrap an API key (no auth required when no keys exist):

```bash
curl -sS -X POST http://localhost:3001/api/ai/keys/bootstrap | tee /tmp/duanju-key.json
# Extract the key:
KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/duanju-key.json')).key)")
echo "API key: $KEY"
```

Then run the integration test against the local server:

```bash
cd /Users/boclaw/Project/duanju-copier
DUANJU_SERVER_URL=http://localhost:3001 DUANJU_API_KEY=$KEY node --test tests/integration-server-contract.test.js
```

Expected: PASS. The server returns 201 with a `story.id` and the response shape contains episodes / scenes / conclusion.

- [ ] **Step 4: Commit**

```bash
git add tests/integration-server-contract.test.js
git commit -m "test: gated end-to-end contract test against ../duanju server"
```

---

## Task 11: Final verification — run full test suite and document manual smoke

**Files:** none (verification only)

**Why:** Confirm nothing else regressed. The earlier tasks renamed `ep.clips` in worker / drama-writer / consistency, which could ripple into `tests/worker.test.js`, `tests/bugfixes.test.js`, etc. that were not touched by individual tasks.

- [ ] **Step 1: Run the entire writer test suite**

Run: `npm test`
Expected: all tests pass. If any test fails referencing `ep.clips` or `clip.setting/action/dialogue/hook` directly, update it the same way Task 5/7 did (rename to `scenes` / `_beats.X`) and add the fix to a new commit:

```bash
git add tests/<failing-file>.test.js
git commit -m "test: update <name> for canonical scene shape"
```

Repeat until `npm test` is fully green.

- [ ] **Step 2: Run the gated integration test against a local server (per Task 10 Step 3)**

If you didn't already run it in Task 10, do it now. Confirm 201 + `story.id`.

- [ ] **Step 3: Smoke-test a real generation job (optional but recommended)**

Configure the writer to point at the local duanju server, then trigger a small job:

```bash
# Edit ~/.duanju-copier/config.json to set:
#   "autostoryUrl": "http://localhost:3001"
#   "aiApiKey": "<key from Task 10 Step 3>"
#   "episodesPerDrama": 2
#   "clipsPerEpisode": 3

# Then enqueue and run a single job (no LLM mocking — this exercises the full pipeline):
node bin/duanju-copier.js enqueue --news-url <some-url-or-omit-for-trends>
node bin/duanju-copier.js work-once
```

Watch the worker log for `Variant vN uploaded: <storyId>` lines (one per variant). Visit `http://localhost:3001/api/ai/stories` (with `X-Api-Key: <key>`) to confirm the stories landed.

- [ ] **Step 4: No extra commit — verification step only**

If Steps 1-3 all pass, the pivot is complete and shippable.

---

## Self-Review Notes

Spec coverage check:
- composeScene + non-enumerable _beats — Task 2/3
- Ending mapping (爽爆→GOOD, 苦尽甘来→NEUTRAL, 反转→SPECIAL) — Task 2 (constant) + Task 3 (parseClip applies it) + Task 4 (fallback applies it)
- Uploader rewrite with new wire shape — Task 9
- Compressor switching to _beats access — Task 6
- Consistency switching to scenes / _beats.hook — Task 5
- Worker counter rename clips→scenes — Task 8
- SCHEMA_VERSION bump — Task 1
- End-to-end test against ../duanju aiRoutes — Task 10
- Drama-writer episode rename clips→scenes (necessary downstream of parseClip reshape, mentioned in spec components table) — Task 7
- prompts/ unchanged, planner/drama-state unchanged — confirmed in plan File Structure (not changed)

Type/symbol consistency: `composeScene`, `ENDING_LABEL_TO_ENUM`, `_beats` are spelled identically in every task that uses them. `episode.scenes` is the consistent rename target throughout.

No placeholders. Every step has the exact code to write or the exact command to run. No "implement appropriately" / "handle errors" / "TODO" steps.
