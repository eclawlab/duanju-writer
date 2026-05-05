# Duanju Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert duanju-writer from a Chinese/English audio-novel generator into a Chinese-only short-form vertical-drama (短剧) script writer per `docs/superpowers/specs/2026-04-28-duanju-pivot-design.md`.

**Architecture:** In-place rewrite plus vocabulary rename (`scene → clip`, `story → drama`). The 7-stage pipeline (research → snowflake → outline → plan → clip writing → variant split → upload) is preserved; the schemas, prompts, and trope library are replaced. AutoStory `/api/ai/stories` endpoint and config key `autostoryUrl` are deliberately retained for stability.

**Tech Stack:** Node.js 20+, ESM modules, native `node --test` runner. No new dependencies.

---

## File Map

### Created
- `src/drama-writer.js` — replaces `src/writer.js` (rename + content rewrite)
- `src/clip-types.js` — replaces `src/scene-types.js` (rename only)
- `src/drama-state.js` — replaces `src/story-state.js` (rename only)
- `tests/drama-writer.test.js` — replaces `tests/writer.test.js`
- `tests/clip-types.test.js` — replaces `tests/scene-types.test.js`
- `tests/drama-state.test.js` — replaces `tests/story-state.test.js`
- `prompts/clips.md` — replaces `prompts/scenes-cn.md` (rename + rewrite)
- `prompts/outline.md` — replaces `prompts/outline-cn.md` (rename + rewrite)
- `prompts/plan.md` — replaces `prompts/plan-cn.md` (rename + rewrite)
- `prompts/research.md` — replaces `prompts/research-cn.md` (rename + rewrite)
- `prompts/snowflake.md` — replaces `prompts/snowflake-cn.md` (rename + rewrite)
- `styles/都市/{战神归来,龙王赘婿,重生归来,系统流,总裁追妻,豪门替嫁,灰姑娘逆袭,真假千金,隐藏身份,一胎二宝}.md`
- `styles/复仇/{重生复仇,替身逆袭,校园复仇,商战复仇,婚后撕渣}.md`
- `styles/甜宠/{校园甜宠,闪婚甜宠,双向暗恋,师兄妹甜宠}.md`
- `styles/古装/{穿越古代,宫斗,仙侠修真,王爷追妻,替嫁王妃}.md`
- `styles/家庭/{婆媳战争,离婚再爱}.md`
- `styles/玄幻/{都市修仙,系统降临,超能力觉醒}.md`

### Modified
- `src/constants.js` — bump `VERSION` to `'0.3.0'`; add `SCHEMA_VERSION = 2`
- `src/config.js` — DEFAULTS: rename `novelType → genre`, `targetWordsPerScene → targetCharsPerClip`; add `episodesPerDrama: 20`, `clipsPerEpisode: 6`; rename `roles.scene → roles.clip`
- `src/uploader.js` — new payload shape with `format: "duanju"`, `clips`, `trope`, `genre`, `characters`
- `src/worker.js` — variant labels `爽爆/苦尽甘来/反转`; rename scene→clip, story→drama in identifiers and worklog text; require `schemaVersion: 2` on resume
- `src/planner.js` — clip-grained plan; identifier rename
- `src/consistency.js` — hook-density check; identifier rename
- `src/compressor.js` — clip-grained compression window; identifier rename
- `src/enrichment.js` — `countChars` for CN replaces `countWords`; identifier rename
- `src/snowflake.js` — identifier rename only (prompt rewrite happens in `prompts/snowflake.md` task)
- `src/collector.js` — add 短剧 trend sources; identifier rename
- `src/setup.js` — display strings: AutoStory → Duanju
- `src/styles.js` — registry already supports categories; only docstring/comment updates
- `bin/duanju-writer.js` — add `--episodes`, `--clips-per-episode`, freeze `--lang`, update `VALID_KEYS`, update `styles` command output, update help text
- `prompts/tail-outline.md` — rewrite for 短剧 endings
- `tests/*` — many updates (per-task)
- `README.md` — full rewrite for 短剧 product

### Deleted
- `src/writer.js`, `src/scene-types.js`, `src/story-state.js` (after rename tasks)
- `tests/writer.test.js`, `tests/scene-types.test.js`, `tests/story-state.test.js` (after rename tasks)
- `prompts/scenes.md`, `prompts/outline.md`, `prompts/plan.md`, `prompts/research.md`, `prompts/snowflake.md` (English versions — note: these are recreated later as Chinese versions, see "Order of operations" below)
- `prompts/scenes-cn.md`, `prompts/outline-cn.md`, `prompts/plan-cn.md`, `prompts/research-cn.md`, `prompts/snowflake-cn.md` (after rename)
- `styles/chinese-literary/`, `styles/chinese-scifi/`, `styles/chinese-webnovel/` (entire literary-style library)

**Order of operations note.** English prompt deletion happens *before* Chinese-prompt rename to avoid filename collision: delete `prompts/outline.md` (English), then rename `prompts/outline-cn.md → prompts/outline.md` (now Chinese-only).

---

## Phase 0 — Foundation

### Task 1: Schema-version constant + version bump

**Files:**
- Modify: `src/constants.js`
- Modify: `tests/constants.test.js`

- [ ] **Step 1: Update the failing test first**

In `tests/constants.test.js`, replace the existing VERSION test and add a SCHEMA_VERSION test:

```js
test('exports VERSION', async () => {
  const { VERSION } = await import('../src/constants.js');
  assert.equal(VERSION, '0.3.0');
});

test('exports SCHEMA_VERSION', async () => {
  const { SCHEMA_VERSION } = await import('../src/constants.js');
  assert.equal(SCHEMA_VERSION, 2);
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/constants.test.js`
Expected: failures on VERSION (still `'0.1.9'`) and missing SCHEMA_VERSION export.

- [ ] **Step 3: Update `src/constants.js`**

Change line 4 to `export const VERSION = '0.3.0';` and add `export const SCHEMA_VERSION = 2;` immediately after it.

- [ ] **Step 4: Run tests pass**

Run: `node --test tests/constants.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/constants.js tests/constants.test.js
git commit -m "chore: bump VERSION to 0.3.0 and add SCHEMA_VERSION constant"
```

---

## Phase 1 — Vocabulary Rename (mechanical)

### Task 2: Rename `src/story-state.js → src/drama-state.js`

**Files:**
- Rename: `src/story-state.js` → `src/drama-state.js`
- Rename: `tests/story-state.test.js` → `tests/drama-state.test.js`
- Modify: every importer of `story-state.js` (use grep to find them)

- [ ] **Step 1: Find import sites**

Run: `grep -rn "story-state" src/ tests/ bin/`
Expected: a list of files importing the module. Capture the list.

- [ ] **Step 2: Rename the source file with `git mv`**

```bash
git mv src/story-state.js src/drama-state.js
git mv tests/story-state.test.js tests/drama-state.test.js
```

- [ ] **Step 3: Update import paths**

In each file from Step 1, replace `'./story-state.js'` with `'./drama-state.js'` (and `'../src/story-state.js'` → `'../src/drama-state.js'` in tests). Use:

```bash
grep -rl "story-state" src/ tests/ bin/ | xargs sed -i '' 's|story-state|drama-state|g'
```

- [ ] **Step 4: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: same pass count as baseline (one pre-existing flake on `tests/llm.test.js:59` is unrelated).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename story-state to drama-state"
```

### Task 3: Rename `src/scene-types.js → src/clip-types.js`

**Files:**
- Rename: `src/scene-types.js` → `src/clip-types.js`
- Rename: `tests/scene-types.test.js` → `tests/clip-types.test.js`
- Modify: every importer

- [ ] **Step 1: Find import sites**

Run: `grep -rn "scene-types" src/ tests/ bin/`

- [ ] **Step 2: Rename and update imports**

```bash
git mv src/scene-types.js src/clip-types.js
git mv tests/scene-types.test.js tests/clip-types.test.js
grep -rl "scene-types" src/ tests/ bin/ | xargs sed -i '' 's|scene-types|clip-types|g'
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: same pass count.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename scene-types to clip-types"
```

### Task 4: Rename `src/writer.js → src/drama-writer.js`

**Files:**
- Rename: `src/writer.js` → `src/drama-writer.js`
- Rename: `tests/writer.test.js` → `tests/drama-writer.test.js`
- Modify: every importer

- [ ] **Step 1: Find import sites**

Run: `grep -rn "from.*writer\.js\|writer\.js'" src/ tests/ bin/`

- [ ] **Step 2: Rename and update imports**

```bash
git mv src/writer.js src/drama-writer.js
git mv tests/writer.test.js tests/drama-writer.test.js
grep -rln "['./]writer\.js" src/ tests/ bin/ | xargs sed -i '' "s|/writer\.js|/drama-writer.js|g"
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: same pass count.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename writer to drama-writer"
```

### Task 5: Identifier sweep `scene → clip` and `STORY_END → DRAMA_END`

This is the broadest mechanical rename. Touches identifiers, JSON keys in tests, log strings, but NOT yet the schemas (those change in Phase 3) and NOT the prompt files (those are rewritten in Phase 6).

**Files:**
- Modify: all `src/*.js` and `tests/*.test.js` files containing `scene` or `STORY_END`

- [ ] **Step 1: Audit current `scene` occurrences**

Run: `grep -rn "scene\|Scene\|SCENE" src/ tests/ bin/ | grep -v node_modules | wc -l`
Capture the baseline count.

- [ ] **Step 2: Identifier-only renames (preserves prompt placeholders for later)**

These are the renames to perform across `src/` and `tests/` (not `prompts/`):

| Before | After |
|---|---|
| `parseScene` | `parseClip` |
| `buildScenePrompt` | `buildClipPrompt` |
| `buildRetryScenePrompt` | `buildRetryClipPrompt` |
| `buildFallbackScene` | `buildFallbackClip` |
| `sceneIndex` | `clipIndex` |
| `nextSceneIndex` | `nextClipIndex` |
| `sceneType` | `clipType` |
| `scenePlan` | `clipPlan` |
| `scenes` (as array property) | `clips` |
| `targetWordsPerScene` (config key) | `targetCharsPerClip` |
| `STORY_END` | `DRAMA_END` |
| `roles.scene` | `roles.clip` (in DEFAULTS and resolution) |

Avoid renaming `sceneFile` / `sceneNumber` etc. unless they are about scenes. Use targeted replacements:

```bash
files=$(grep -rl "parseScene\|buildScenePrompt\|buildRetryScenePrompt\|buildFallbackScene\|sceneIndex\|nextSceneIndex\|sceneType\|scenePlan\|targetWordsPerScene\|STORY_END" src/ tests/ bin/)
for f in $files; do
  sed -i '' \
    -e 's/parseScene/parseClip/g' \
    -e 's/buildScenePrompt/buildClipPrompt/g' \
    -e 's/buildRetryScenePrompt/buildRetryClipPrompt/g' \
    -e 's/buildFallbackScene/buildFallbackClip/g' \
    -e 's/sceneIndex/clipIndex/g' \
    -e 's/nextSceneIndex/nextClipIndex/g' \
    -e 's/sceneType/clipType/g' \
    -e 's/scenePlan/clipPlan/g' \
    -e 's/targetWordsPerScene/targetCharsPerClip/g' \
    -e 's/STORY_END/DRAMA_END/g' \
    "$f"
done
```

- [ ] **Step 3: Rename `scenes` → `clips` only as a JSON property name**

`scenes` is a more dangerous identifier (matches `scenes-cn.md`, scene-related variables, etc.). Do this one carefully, file by file. Find offenders:

Run: `grep -rn "scenes:" src/ tests/ bin/ | grep -v node_modules | grep -v prompts`

For each match, manually verify it refers to the array property (e.g. `scenes: []`, `episode.scenes`, `scenes.map(...)`, `for (const scene of episode.scenes)`) and replace with `clips`. Also update the loop variable: `for (const scene of episode.clips) → for (const clip of episode.clips)`. Identifiers like `scenesGenerated`, `sceneCount` get renamed to `clipsGenerated`, `clipCount`.

- [ ] **Step 4: Update worker.js worklog summary text**

In `src/worker.js`, line containing `=== Duanju Writer Work Log Summary ===` is fine (already renamed in prior task), but log lines like `wlog('clipsGenerated', ...)` (was `'scenesGenerated'`) need to match the rename. Find and update:

```bash
grep -n "scene\|Scene" src/worker.js
```

Update each occurrence to `clip`/`Clip` only when it refers to the unit, not when scene refers to "scene of action" or similar metaphors.

- [ ] **Step 5: Update story → drama in identifiers (NOT `storyId` field returned by API)**

Renames (carefully):
| Before | After |
|---|---|
| `processStory` (if any) | `processDrama` |
| `generateStory` | `generateDrama` |
| `storyState` (variable) | `dramaState` |
| `Story Writer Work Log Summary` | already `Duanju Writer Work Log Summary` from prior task |

Do NOT rename:
- `storyId` (response field from `/api/ai/stories` — preserves API contract)
- `storyIds[]` (array of returned IDs)
- the endpoint path `/api/ai/stories`

```bash
files=$(grep -rl "generateStory\|storyState\b" src/ tests/ bin/)
for f in $files; do
  sed -i '' \
    -e 's/generateStory/generateDrama/g' \
    -e 's/\bstoryState\b/dramaState/g' \
    "$f"
done
```

- [ ] **Step 6: Run full test suite**

Run: `npm test 2>&1 | tail -25`
Expected: all tests pass except the 1 pre-existing flake. If failures appear, fix the test data/expectations to match the rename (this is the rename's blast radius — symbol references in test data need updating).

- [ ] **Step 7: Verify no obvious leakage**

Run: `grep -rn "parseScene\|buildScenePrompt\|sceneIndex\|nextSceneIndex\|sceneType\|scenePlan\|STORY_END" src/ tests/ bin/`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: sweep scene→clip, story→drama identifiers and JSON keys"
```

---

## Phase 2 — CLI & Config

### Task 6: Add `--episodes` / `--clips-per-episode` flags, rename config keys, freeze `--lang`

**Files:**
- Modify: `src/config.js` (DEFAULTS lines 6–34)
- Modify: `bin/duanju-writer.js` (`run` parser, `VALID_KEYS`, `styles` output, help text, lang validation)
- Modify: `tests/config.test.js`
- Create: `tests/cli-flags.test.js`

- [ ] **Step 1: Update `tests/config.test.js`**

Update existing assertions and add new ones for renamed/new keys:

```js
test('DEFAULTS includes new duanju keys', async () => {
  const { loadConfigFrom } = await import('../src/config.js');
  // Pass a non-existent file so we get pure defaults
  const cfg = loadConfigFrom('/nonexistent.json');
  assert.equal(cfg.episodesPerDrama, 20);
  assert.equal(cfg.clipsPerEpisode, 6);
  assert.equal(cfg.targetCharsPerClip, 50);
  assert.equal(cfg.genre, '');
  assert.equal(cfg.lang, 'cn');
  assert.equal(cfg.roles.clip, 'claude');  // renamed from scene
});

test('DEFAULTS no longer has retired keys', async () => {
  const { loadConfigFrom } = await import('../src/config.js');
  const cfg = loadConfigFrom('/nonexistent.json');
  assert.equal(cfg.targetWordsPerScene, undefined);
  assert.equal(cfg.novelType, undefined);
  assert.equal(cfg.roles.scene, undefined);
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/config.test.js`
Expected: failures on the new assertions.

- [ ] **Step 3: Update `src/config.js` DEFAULTS**

Replace lines 6–34 with:

```js
const DEFAULTS = {
  autostoryUrl: 'https://usaduanju.com',
  aiApiKey: '',
  heartbeatInterval: 1800000,
  claudePath: 'claude',
  maxRetries: 3,
  maxConcurrentJobs: 1,
  publishOnUpload: true,
  targetCharsPerClip: 50,         // 0 = disabled
  episodesPerDrama: 20,
  clipsPerEpisode: 6,
  lang: 'cn',
  genre: '',
  referenceCharacter: '',
  referenceEvent: '',
  style: 'default',
  providers: {
    claude: { type: 'claude-cli', claudePath: 'claude', timeout: 1500000 },
    openai: { type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: '', timeout: 120000 },
  },
  roles: {
    research: 'claude',
    outline: 'claude',
    plan: 'claude',
    clip: 'claude',
    compress: 'claude',
    consistency: 'claude',
    style: 'claude',
    repair: 'claude',
  },
};
```

- [ ] **Step 4: Run config tests**

Run: `node --test tests/config.test.js`
Expected: pass.

- [ ] **Step 5: Update `bin/duanju-writer.js` — `VALID_KEYS`**

Find the `VALID_KEYS` array (currently around line 220) and replace with:

```js
const VALID_KEYS = [
  'autostoryUrl', 'aiApiKey', 'heartbeatInterval', 'claudePath',
  'maxRetries', 'publishOnUpload', 'lang', 'genre',
  'referenceCharacter', 'referenceEvent', 'style',
  'targetCharsPerClip', 'episodesPerDrama', 'clipsPerEpisode',
];
```

Also add an explicit deprecation hint in the `Unknown config key` branch:

```js
if (!VALID_KEYS.includes(args[1])) {
  if (args[1] === 'novelType') {
    console.log(`'novelType' has been renamed to 'genre'. Use: duanju-writer config set genre <value>`);
  } else if (args[1] === 'targetWordsPerScene') {
    console.log(`'targetWordsPerScene' has been renamed to 'targetCharsPerClip'. Use: duanju-writer config set targetCharsPerClip <value>`);
  } else {
    console.log(`Unknown config key: ${args[1]}`);
    console.log(`Valid keys: ${VALID_KEYS.join(', ')}`);
  }
  process.exit(1);
}
```

- [ ] **Step 6: Update `bin/duanju-writer.js` — `run` flag parser**

Locate the `case 'run':` block (~line 100). After existing flag parsing, add `--episodes` and `--clips-per-episode` handling and validate ranges:

```js
let episodesPerDrama = config.episodesPerDrama || 20;
let clipsPerEpisode = config.clipsPerEpisode || 6;
const epIdx = args.indexOf('--episodes');
if (epIdx !== -1 && args[epIdx + 1]) {
  const n = Number(args[epIdx + 1]);
  if (!Number.isInteger(n) || n < 10 || n > 40) {
    console.log(`--episodes must be an integer in [10, 40], got: ${args[epIdx + 1]}`);
    process.exit(1);
  }
  episodesPerDrama = n;
}
const cpeIdx = args.indexOf('--clips-per-episode');
if (cpeIdx !== -1 && args[cpeIdx + 1]) {
  const k = Number(args[cpeIdx + 1]);
  if (!Number.isInteger(k) || k < 4 || k > 10) {
    console.log(`--clips-per-episode must be an integer in [4, 10], got: ${args[cpeIdx + 1]}`);
    process.exit(1);
  }
  clipsPerEpisode = k;
}
```

Then thread `episodesPerDrama` and `clipsPerEpisode` into both `createJob({...})` and `runOnce(job.id, {...})` option objects (alongside existing `lang`, `style`, etc.).

- [ ] **Step 7: Freeze `--lang en`**

In the same `run` block, after parsing `lang`:

```js
if (lang !== 'cn') {
  console.log(`--lang ${lang} is not supported (CN only).`);
  process.exit(1);
}
```

(If `--lang` parsing currently extracts the value into a `lang` variable, this check goes after that extraction. If `lang` defaults from config, validate the same way.)

Apply the same freeze in the `config set lang` branch:

```js
if (args[1] === 'lang' && value !== 'cn') {
  console.log(`Invalid lang "${value}". Only 'cn' is supported.`);
  process.exit(1);
}
```

- [ ] **Step 8: Update `--type` rename to `--genre` (or accept both)**

Find the existing `--type` parsing in `case 'run':`. Rename the local variable from `novelType` to `genre`. The CLI flag stays `--type` for now (backwards-compat for muscle memory), but the code variable / config key becomes `genre`. Update the relevant lines:

```js
const typeIdx = args.indexOf('--type');
const genre = typeIdx !== -1 && args[typeIdx + 1] ? args[typeIdx + 1] : (config.genre || '');
```

Then thread `genre` (not `novelType`) into job options and downstream.

- [ ] **Step 9: Create `tests/cli-flags.test.js`**

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BIN = new URL('../bin/duanju-writer.js', import.meta.url).pathname;

function runCli(args) {
  try {
    const out = execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
}

describe('cli flag validation', () => {
  test('--episodes 5 is rejected (below range)', () => {
    const r = runCli(['run', '--episodes', '5']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--episodes must be an integer in \[10, 40\]/);
  });

  test('--episodes 50 is rejected (above range)', () => {
    const r = runCli(['run', '--episodes', '50']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--episodes must be an integer in \[10, 40\]/);
  });

  test('--clips-per-episode 3 is rejected', () => {
    const r = runCli(['run', '--clips-per-episode', '3']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--clips-per-episode must be an integer in \[4, 10\]/);
  });

  test('--clips-per-episode 12 is rejected', () => {
    const r = runCli(['run', '--clips-per-episode', '12']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--clips-per-episode must be an integer in \[4, 10\]/);
  });

  test('--lang en is rejected', () => {
    const r = runCli(['run', '--lang', 'en']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--lang en is not supported \(CN only\)/);
  });

  test('config set novelType errors with rename hint', () => {
    const r = runCli(['config', 'set', 'novelType', '都市']);
    assert.equal(r.code, 1);
    assert.match(r.out, /'novelType' has been renamed to 'genre'/);
  });

  test('config set targetWordsPerScene errors with rename hint', () => {
    const r = runCli(['config', 'set', 'targetWordsPerScene', '50']);
    assert.equal(r.code, 1);
    assert.match(r.out, /'targetWordsPerScene' has been renamed to 'targetCharsPerClip'/);
  });
});
```

- [ ] **Step 10: Run new and full test suite**

Run: `node --test tests/cli-flags.test.js && npm test 2>&1 | tail -15`
Expected: cli-flags.test.js passes; full suite stays green minus pre-existing flake.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add --episodes/--clips-per-episode flags, rename config keys, freeze --lang to cn"
```

---

## Phase 3 — Schema & Validators

### Task 7: Rewrite `parseOutline` for the new linear drama schema

**Files:**
- Modify: `src/drama-writer.js` (locate `parseOutline` and `buildOutlinePrompt`)
- Modify: `tests/drama-writer.test.js`
- Reference: `docs/superpowers/specs/2026-04-28-duanju-pivot-design.md` §2.1, §2.2

- [ ] **Step 1: Identify `parseOutline` location**

Run: `grep -n "parseOutline\|export function parseOutline" src/drama-writer.js`
Capture the function span (start/end lines).

- [ ] **Step 2: Update `tests/drama-writer.test.js` — outline parser tests**

Replace the existing parseOutline tests block with the new constraints:

```js
describe('parseOutline (drama)', () => {
  function validOutline() {
    return {
      title: '战神归来',
      synopsis: '两句话钩子简介。',
      trope: '战神归来',
      genre: '都市',
      tags: ['复仇', '打脸'],
      lang: 'cn',
      characters: [
        { name: '陆衡', role: 'protagonist', description: '...' },
        { name: '苏晚', role: 'ex-wife', description: '...' },
        { name: '林董', role: 'antagonist', description: '...' },
      ],
      episodes: [
        { episodeIndex: 0, title: '第1集', isEnding: false, ending: null,
          clipPlan: [{ summary: 's', clipType: 'NARRATIVE', isConclusion: false }] },
        { episodeIndex: 1, title: '第2集', isEnding: true, ending: '爽爆',
          clipPlan: [{ summary: 's', clipType: 'NARRATIVE', isConclusion: true }] },
      ],
    };
  }

  test('accepts valid linear outline', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const o = parseOutline(JSON.stringify(validOutline()));
    assert.equal(o.episodes.length, 2);
    assert.equal(o.trope, '战神归来');
  });

  test('rejects fewer than 2 episodes', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes = [bad.episodes[0]];
    assert.throws(() => parseOutline(JSON.stringify(bad)), /at least 2/);
  });

  test('rejects missing isEnding on final episode', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[1].isEnding = false;
    assert.throws(() => parseOutline(JSON.stringify(bad)), /final episode must have isEnding/);
  });

  test('rejects invalid ending value', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[1].ending = 'GOOD';
    assert.throws(() => parseOutline(JSON.stringify(bad)), /ending must be one of/);
  });

  test('rejects fewer than 3 characters', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.characters = [bad.characters[0], bad.characters[1]];
    assert.throws(() => parseOutline(JSON.stringify(bad)), /3.*7 characters/);
  });

  test('rejects more than 7 characters', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.characters = Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, role: 'r', description: 'd' }));
    assert.throws(() => parseOutline(JSON.stringify(bad)), /3.*7 characters/);
  });

  test('rejects duplicate episodeIndex', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodes[1].episodeIndex = 0;
    assert.throws(() => parseOutline(JSON.stringify(bad)), /duplicate episodeIndex/);
  });

  test('strips episodeChoices and characterQuestions if present', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const bad = validOutline();
    bad.episodeChoices = [{ from: 0, to: 1 }];
    bad.characterQuestions = [{ q: 'x' }];
    const o = parseOutline(JSON.stringify(bad));
    assert.equal(o.episodeChoices, undefined);
    assert.deepEqual(o.characterQuestions, []);
  });

  test('strips markdown code fences', async () => {
    const { parseOutline } = await import('../src/drama-writer.js');
    const wrapped = '```json\n' + JSON.stringify(validOutline()) + '\n```';
    const o = parseOutline(wrapped);
    assert.equal(o.title, '战神归来');
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `node --test tests/drama-writer.test.js`
Expected: failures on every new assertion.

- [ ] **Step 4: Rewrite `parseOutline` in `src/drama-writer.js`**

Replace the function with:

```js
const VALID_ENDINGS = ['爽爆', '苦尽甘来', '反转'];

export function parseOutline(rawText) {
  // Strip ```json fences if present
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let data;
  try { data = JSON.parse(text); }
  catch (err) { throw new Error(`outline JSON parse failed: ${err.message}`); }

  if (!data.title || typeof data.title !== 'string') throw new Error('outline missing title');
  if (!data.synopsis || typeof data.synopsis !== 'string') throw new Error('outline missing synopsis');
  if (!Array.isArray(data.episodes) || data.episodes.length < 2) {
    throw new Error('outline must have at least 2 episodes');
  }

  // Characters
  if (!Array.isArray(data.characters) || data.characters.length < 3 || data.characters.length > 7) {
    throw new Error('outline must have 3 to 7 characters');
  }
  for (const c of data.characters) {
    if (!c.name || !c.role) throw new Error('character missing name or role');
  }

  // Episode validation
  const seen = new Set();
  for (const ep of data.episodes) {
    if (!Number.isInteger(ep.episodeIndex)) throw new Error('episode missing episodeIndex');
    if (seen.has(ep.episodeIndex)) throw new Error(`duplicate episodeIndex: ${ep.episodeIndex}`);
    seen.add(ep.episodeIndex);
    if (!Array.isArray(ep.clipPlan) || ep.clipPlan.length === 0) {
      throw new Error(`episode ${ep.episodeIndex} has empty clipPlan`);
    }
  }

  const lastEp = data.episodes[data.episodes.length - 1];
  if (!lastEp.isEnding) throw new Error('final episode must have isEnding: true');
  if (!VALID_ENDINGS.includes(lastEp.ending)) {
    throw new Error(`final episode ending must be one of ${VALID_ENDINGS.join('/')}, got: ${lastEp.ending}`);
  }

  // Strip forbidden fields
  delete data.episodeChoices;
  data.characterQuestions = [];

  return data;
}

export { VALID_ENDINGS };
```

- [ ] **Step 5: Run tests pass**

Run: `node --test tests/drama-writer.test.js`
Expected: all parseOutline tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: rewrite parseOutline for linear drama schema with 短剧 endings"
```

### Task 8: Implement `parseClip` for the new clip schema

**Files:**
- Modify: `src/drama-writer.js` (replace existing `parseClip` if it exists from rename, or add)
- Modify: `tests/drama-writer.test.js`
- Reference: spec §2.3, §2.4, §2.5

- [ ] **Step 1: Add `parseClip` tests in `tests/drama-writer.test.js`**

```js
describe('parseClip', () => {
  function validClip() {
    return {
      clipIndex: 0,
      setting: '豪门别墅 · 夜 · 暴雨',
      action: '陆衡推开大门，浑身湿透站在前妻苏晚面前。',
      dialogue: '[narrator]\n五年了。\n[character:陆衡]\n我回来了。',
      hook: '苏晚的手机响起，来电显示：林董事长。',
      durationSec: 12,
      isConclusion: false,
      conclusion: null,
    };
  }

  test('accepts valid clip', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const c = parseClip(JSON.stringify(validClip()));
    assert.equal(c.clipIndex, 0);
    assert.equal(c.hook.length > 0, true);
  });

  test('rejects missing hook on non-conclusion clip', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.hook = '';
    assert.throws(() => parseClip(JSON.stringify(bad)), /hook required/);
  });

  test('rejects dialogue exceeding 60 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.dialogue = '[narrator]\n' + '一'.repeat(70);
    assert.throws(() => parseClip(JSON.stringify(bad)), /dialogue.*60/);
  });

  test('rejects action exceeding 80 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.action = '一'.repeat(90);
    assert.throws(() => parseClip(JSON.stringify(bad)), /action.*80/);
  });

  test('rejects setting exceeding 20 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.setting = '一'.repeat(25);
    assert.throws(() => parseClip(JSON.stringify(bad)), /setting.*20/);
  });

  test('rejects hook exceeding 30 CN chars', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.hook = '一'.repeat(35);
    assert.throws(() => parseClip(JSON.stringify(bad)), /hook.*30/);
  });

  test('conclusion clip allows empty hook and requires conclusion object with DRAMA_END type', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const c = validClip();
    c.isConclusion = true;
    c.hook = '';
    c.conclusion = { title: '结局', overview: '...', type: 'DRAMA_END', ending: '爽爆' };
    const parsed = parseClip(JSON.stringify(c));
    assert.equal(parsed.isConclusion, true);
    assert.equal(parsed.conclusion.type, 'DRAMA_END');
  });

  test('rejects conclusion clip with wrong conclusion.type', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.isConclusion = true;
    bad.hook = '';
    bad.conclusion = { title: 't', overview: 'o', type: 'STORY_END', ending: '爽爆' };
    assert.throws(() => parseClip(JSON.stringify(bad)), /conclusion\.type.*DRAMA_END/);
  });

  test('strips voice IDs and player blocks from dialogue', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const bad = validClip();
    bad.dialogue = '[character:陆衡|voice:alloy]\n来了\n[player]\n好的';
    const parsed = parseClip(JSON.stringify(bad));
    assert.ok(!parsed.dialogue.includes('|voice:'));
    assert.ok(!parsed.dialogue.includes('[player]'));
  });

  test('strips markdown code fences', async () => {
    const { parseClip } = await import('../src/drama-writer.js');
    const wrapped = '```json\n' + JSON.stringify(validClip()) + '\n```';
    const c = parseClip(wrapped);
    assert.equal(c.clipIndex, 0);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/drama-writer.test.js`
Expected: parseClip tests fail (function doesn't exist or doesn't enforce limits).

- [ ] **Step 3: Implement `parseClip` in `src/drama-writer.js`**

Add the function (or replace any partially-renamed version from Phase 1):

```js
const CLIP_LIMITS = { setting: 20, action: 80, dialogue: 60, hook: 30 };

function countCnChars(s) {
  // Count Chinese-script characters only (Unicode range U+4E00–U+9FFF and CJK extensions)
  // Whitespace, punctuation, and ASCII don't count toward the spoken-content budget.
  return (s.match(/[一-鿿㐀-䶿]/g) || []).length;
}

function stripDialogueAnnotations(s) {
  // Remove |voice:xxx attributes and entire [player] blocks
  let out = s.replace(/\|voice:[a-z]+/g, '');
  out = out.replace(/\[player\][^[]*?(?=\[|$)/g, '');
  return out.trim();
}

export function parseClip(rawText) {
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let data;
  try { data = JSON.parse(text); }
  catch (err) { throw new Error(`clip JSON parse failed: ${err.message}`); }

  if (!Number.isInteger(data.clipIndex)) throw new Error('clip missing clipIndex');
  for (const field of ['setting', 'action', 'dialogue']) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      throw new Error(`clip missing ${field}`);
    }
  }

  // Sanitize dialogue
  data.dialogue = stripDialogueAnnotations(data.dialogue);

  // Length limits (CN-char count, not byte/code-unit length)
  for (const [field, limit] of Object.entries(CLIP_LIMITS)) {
    const value = data[field] || '';
    const n = countCnChars(value);
    if (n > limit) {
      throw new Error(`clip.${field} has ${n} CN chars, max ${limit}`);
    }
  }

  // Hook required for non-conclusion clips
  if (!data.isConclusion && (!data.hook || data.hook.trim().length === 0)) {
    throw new Error('clip.hook required for non-conclusion clips');
  }

  // Conclusion validation
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
  } else {
    data.conclusion = null;
  }

  if (typeof data.durationSec !== 'number' || data.durationSec < 6 || data.durationSec > 20) {
    data.durationSec = 12;  // sane default if unset/out-of-range
  }

  return data;
}
```

- [ ] **Step 4: Run tests pass**

Run: `node --test tests/drama-writer.test.js`
Expected: all parseClip tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: add parseClip with CN-char limits and hook enforcement"
```

### Task 9: Update `parseTailOutline` for new ending labels

**Files:**
- Modify: `src/drama-writer.js` (`parseTailOutline`, `VALID_TAIL_ENDINGS`)
- Modify: `tests/drama-writer.test.js`

- [ ] **Step 1: Update tail-outline tests**

Find existing tests with `GOOD/BITTERSWEET/SPECIAL` and replace ending values with `爽爆/苦尽甘来/反转`. Keep all the structural assertions (episode-count math, episodeIndex coercion, etc.). Add:

```js
test('VALID_TAIL_ENDINGS exposes the three drama endings', async () => {
  const { VALID_TAIL_ENDINGS } = await import('../src/drama-writer.js');
  assert.deepEqual([...VALID_TAIL_ENDINGS].sort(), ['反转', '爽爆', '苦尽甘来']);
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/drama-writer.test.js`
Expected: tail-outline tests fail on ending values.

- [ ] **Step 3: Update `src/drama-writer.js`**

Replace the existing constant:

```js
export const VALID_TAIL_ENDINGS = new Set(['爽爆', '苦尽甘来', '反转']);
```

Update any inline `['GOOD', 'BITTERSWEET', 'SPECIAL']` arrays to use the new endings.

- [ ] **Step 4: Run tests**

Run: `node --test tests/drama-writer.test.js`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: relabel tail-outline endings to 爽爆/苦尽甘来/反转"
```

---

## Phase 4 — Pipeline Modules

### Task 10: `buildClipPrompt` and `buildFallbackClip`

**Files:**
- Modify: `src/drama-writer.js`
- Modify: `tests/drama-writer.test.js`
- Reference: spec §2.3 for clip schema, §4.2 for prompt requirements

- [ ] **Step 1: Add tests for `buildClipPrompt`**

```js
describe('buildClipPrompt', () => {
  function ctx() {
    return {
      outline: { title: '战神归来', synopsis: 's', characters: [{name:'陆衡',role:'p',description:'d'}] },
      episode: { episodeIndex: 0, title: '第1集', clipPlan: [{summary:'登场',isConclusion:false}] },
      clipIndex: 0,
      totalClips: 6,
      clipSummary: '陆衡推门归来',
      isConclusion: false,
      priorClipDigest: '',
      tropeSection: '## Clip\n短促对白，反问句多。',
    };
  }

  test('injects clipIndex, totalClips, summary', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(ctx());
    assert.match(p, /clip 0 of 6/i);
    assert.match(p, /陆衡推门归来/);
  });

  test('injects trope ## Clip section', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(ctx());
    assert.match(p, /短促对白，反问句多/);
  });

  test('does not include voice IDs or [player] block guidance', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(ctx());
    assert.ok(!/\|voice:/.test(p), 'prompt should not mention |voice:');
    assert.ok(!/\[player\]/.test(p), 'prompt should not mention [player] blocks');
  });

  test('marks conclusion clip context when isConclusion=true', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const c = ctx();
    c.isConclusion = true;
    const p = buildClipPrompt(c);
    assert.match(p, /conclusion|DRAMA_END|结局/i);
  });
});

describe('buildFallbackClip', () => {
  test('produces a parser-valid clip from plan data', async () => {
    const { buildFallbackClip, parseClip } = await import('../src/drama-writer.js');
    const c = buildFallbackClip({
      clipIndex: 2,
      summary: '陆衡推门进入豪门',
      isConclusion: false,
    });
    // Must round-trip through parseClip without throwing
    const parsed = parseClip(JSON.stringify(c));
    assert.equal(parsed.clipIndex, 2);
    assert.ok(parsed.hook && parsed.hook.length > 0);
  });

  test('produces a valid conclusion clip when isConclusion=true', async () => {
    const { buildFallbackClip, parseClip } = await import('../src/drama-writer.js');
    const c = buildFallbackClip({
      clipIndex: 5,
      summary: '陆衡身份揭露',
      isConclusion: true,
      ending: '爽爆',
    });
    const parsed = parseClip(JSON.stringify(c));
    assert.equal(parsed.isConclusion, true);
    assert.equal(parsed.conclusion.type, 'DRAMA_END');
    assert.equal(parsed.conclusion.ending, '爽爆');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/drama-writer.test.js`

- [ ] **Step 3: Implement `buildClipPrompt`**

Add to `src/drama-writer.js`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIPS_PROMPT_PATH = join(import.meta.dirname, '..', 'prompts', 'clips.md');

export function buildClipPrompt({
  outline,
  episode,
  clipIndex,
  totalClips,
  clipSummary,
  isConclusion,
  priorClipDigest,
  tropeSection,         // the `## Clip` section from the trope file
  referenceCharacter,   // optional markdown
  referenceEvent,       // optional markdown
}) {
  const template = readFileSync(CLIPS_PROMPT_PATH, 'utf8');
  return template
    .replace(/{{title}}/g, outline.title || '')
    .replace(/{{synopsis}}/g, outline.synopsis || '')
    .replace(/{{characters}}/g, JSON.stringify(outline.characters || [], null, 2))
    .replace(/{{episodeTitle}}/g, episode.title || '')
    .replace(/{{episodeIndex}}/g, String(episode.episodeIndex))
    .replace(/{{clipIndex}}/g, String(clipIndex))
    .replace(/{{totalClips}}/g, String(totalClips))
    .replace(/{{clipSummary}}/g, clipSummary || '')
    .replace(/{{isConclusion}}/g, isConclusion ? 'true' : 'false')
    .replace(/{{priorClipDigest}}/g, priorClipDigest || '(none)')
    .replace(/{{tropeSection}}/g, tropeSection || '')
    .replace(/{{referenceCharacter}}/g, referenceCharacter || '')
    .replace(/{{referenceEvent}}/g, referenceEvent || '');
}
```

(The `prompts/clips.md` template doesn't exist yet; that's Task 19. The test in Step 1 will fail with "ENOENT" until then. To unblock this task, create a stub `prompts/clips.md` with all the placeholders so the template-substitution pass works:)

Create `prompts/clips.md` (stub — full rewrite is Task 19):
```
You are writing one 10–15 second clip of a 短剧 series.

Drama: {{title}}
Synopsis: {{synopsis}}
Episode {{episodeIndex}}: {{episodeTitle}}
Clip {{clipIndex}} of {{totalClips}}: {{clipSummary}}
Conclusion: {{isConclusion}}

Prior clip digest: {{priorClipDigest}}

Characters:
{{characters}}

Trope guidance:
{{tropeSection}}

Reference character (optional): {{referenceCharacter}}
Reference event (optional): {{referenceEvent}}

Output schema and constraints will be filled in when this prompt is fully written (see Task 19).
```

- [ ] **Step 4: Implement `buildFallbackClip`**

Add to `src/drama-writer.js`:

```js
export function buildFallbackClip({ clipIndex, summary, isConclusion, ending }) {
  const setting = '场景 · 时间 · 氛围';
  const action = (summary || '动作描述').slice(0, 80);
  const dialogue = '[narrator]\n' + (summary || '叙述').slice(0, 50);
  const base = {
    clipIndex,
    setting,
    action,
    dialogue,
    durationSec: 12,
    isConclusion: !!isConclusion,
  };
  if (isConclusion) {
    base.hook = '';
    base.conclusion = {
      title: '结局',
      overview: summary || '故事结束',
      type: 'DRAMA_END',
      ending: ending || '爽爆',
    };
  } else {
    base.hook = '镜头特写关键道具';
    base.conclusion = null;
  }
  return base;
}
```

- [ ] **Step 5: Run tests pass**

Run: `node --test tests/drama-writer.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js prompts/clips.md
git commit -m "feat: add buildClipPrompt and buildFallbackClip with clips.md stub"
```

### Task 11: Wire `generateDrama` to use clip pipeline

**Files:**
- Modify: `src/drama-writer.js` (the `generateDrama` orchestration function — was `generateStory` before rename)
- Modify: `tests/drama-writer.test.js`

The orchestration function must iterate episodes×clips, call `parseClip`, fall back to `buildFallbackClip` on retry exhaustion, persist incrementally, and emit `clips: []` rather than `scenes: []` on the episode object.

- [ ] **Step 1: Inspect existing `generateDrama` (was `generateStory`)**

Run: `grep -n "export.*function generateDrama\|export.*function generateStory" src/drama-writer.js`
Read 30 lines of context around the match.

- [ ] **Step 2: Replace the inner clip-generation loop**

Inside `generateDrama`, find the loop that fills each episode with scenes (now clips per Phase 1 rename). Replace it with:

```js
for (const episode of outline.episodes) {
  episode.clips = [];
  const lastClipIdx = episode.clipPlan.length - 1;
  let priorClipDigest = '';

  for (let i = 0; i < episode.clipPlan.length; i++) {
    const planEntry = episode.clipPlan[i];
    const isConclusion = !!planEntry.isConclusion ||
      (episode.isEnding && i === lastClipIdx);
    const ctx = {
      outline,
      episode,
      clipIndex: i,
      totalClips: episode.clipPlan.length,
      clipSummary: planEntry.summary,
      isConclusion,
      priorClipDigest,
      tropeSection: tropeSection || '',
      referenceCharacter,
      referenceEvent,
    };

    let clip;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const prompt = (attempt === 0)
          ? buildClipPrompt(ctx)
          : buildRetryClipPrompt({ ...ctx, prevError: lastErr?.message });
        const raw = await callLLM(prompt, 'clip');
        clip = parseClip(raw);
        break;
      } catch (err) {
        lastErr = err;
        log?.(`  [E${episode.episodeIndex} C${i}] attempt ${attempt + 1} failed: ${err.message}`);
      }
    }

    if (!clip) {
      log?.(`  [E${episode.episodeIndex} C${i}] all retries exhausted, using fallback`);
      clip = buildFallbackClip({
        clipIndex: i,
        summary: planEntry.summary,
        isConclusion,
        ending: isConclusion ? episode.ending : null,
      });
    }

    episode.clips.push(clip);
    priorClipDigest = compressPriorClips(episode.clips);
  }

  delete episode.clipPlan;
}
```

(The `compressPriorClips` helper either exists from rename or needs a one-liner: `function compressPriorClips(clips) { return clips.map(c => c.action).slice(-3).join(' / '); }`)

- [ ] **Step 3: Add `buildRetryClipPrompt`**

A simplified prompt that retries with the parse error feedback:

```js
export function buildRetryClipPrompt({ clipSummary, prevError, isConclusion }) {
  const conclusion = isConclusion
    ? '\nThis is the conclusion clip. Include a conclusion object with type "DRAMA_END" and a valid ending.'
    : '\nThis is a non-conclusion clip. Include a non-empty hook field (≤30 CN chars).';
  return [
    `Previous attempt failed: ${prevError || 'invalid output'}.`,
    `Generate one short-drama clip (10–15 seconds) based on this summary:`,
    clipSummary,
    `Strict limits (CN char counts): setting≤20, action≤80, dialogue≤60, hook≤30.`,
    `Output ONLY a single JSON object matching the clip schema. No markdown fences, no commentary.`,
    conclusion,
  ].join('\n');
}
```

- [ ] **Step 4: Add a smoke test that the orchestration produces parser-valid clips**

```js
test('generateDrama produces clips that round-trip through parseClip (mocked LLM)', async () => {
  // Mock callLLM by intercepting via the LLM module
  // (alternative: pass a custom callLLM dependency through the function signature)
  // For now, a structural test on the assembly logic only.
  // ...
});
```

(If the existing `generateStory` had a mocked-LLM smoke test, port it. Otherwise, this round-trip can be exercised by the manual validation gate; a unit test of the inner loop with a stubbed `callLLM` is optional and depends on existing testability of the orchestration.)

- [ ] **Step 5: Run full test suite**

Run: `npm test 2>&1 | tail -15`
Expected: all green minus pre-existing flake.

- [ ] **Step 6: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: clip-iterating generateDrama with retries and fallback"
```

### Task 12: Update `planner.js` for clip-grained planning

**Files:**
- Modify: `src/planner.js`
- Modify: `tests/planner.test.js`

- [ ] **Step 1: Read existing planner**

Run: `wc -l src/planner.js && grep -n "scene\|story" src/planner.js`

- [ ] **Step 2: Update tests**

Replace any `scenePlan`-keyed assertions with `clipPlan`. Replace state-shape assertions about `scenes[]` with `clips[]`. Run them and verify they fail.

- [ ] **Step 3: Update `src/planner.js`**

Find the planner's plan-shape construction and rename `scenes:` → `clips:`. Find the prompt-template loader. Update it to use `prompts/plan.md` (was `plan-cn.md` until Task 21 renames it; until then, leave path as `plan-cn.md` and adjust in Task 21).

If the planner emits a `revelations` array per scene-index, change the index key from `revealInScene` to `revealInClip`. Update `drama-state.js` consumers accordingly:

```bash
grep -rn "revealInScene" src/ tests/ | xargs sed -i '' 's/revealInScene/revealInClip/g'
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/planner.test.js tests/drama-state.test.js`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: planner emits clip-grained plan, revealInScene→revealInClip"
```

### Task 13: Hook-density check in `consistency.js`

**Files:**
- Modify: `src/consistency.js`
- Modify: `tests/consistency.test.js`

- [ ] **Step 1: Add hook-density test**

In `tests/consistency.test.js`:

```js
describe('hook density check', () => {
  test('detects clip missing hook on non-conclusion', async () => {
    const { checkHookDensity } = await import('../src/consistency.js');
    const episode = {
      isEnding: false,
      clips: [
        { clipIndex: 0, hook: '来电响起', isConclusion: false },
        { clipIndex: 1, hook: '', isConclusion: false },  // ← offending
      ],
    };
    const issues = checkHookDensity(episode);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /clip 1.*missing hook/);
  });

  test('allows empty hook on conclusion clip', async () => {
    const { checkHookDensity } = await import('../src/consistency.js');
    const episode = {
      isEnding: true,
      clips: [
        { clipIndex: 0, hook: '反派出现', isConclusion: false },
        { clipIndex: 1, hook: '', isConclusion: true },
      ],
    };
    assert.deepEqual(checkHookDensity(episode), []);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/consistency.test.js`

- [ ] **Step 3: Implement `checkHookDensity`**

In `src/consistency.js`, add and export:

```js
export function checkHookDensity(episode) {
  const issues = [];
  for (const clip of episode.clips || []) {
    if (clip.isConclusion) continue;
    if (!clip.hook || clip.hook.trim().length === 0) {
      issues.push(`clip ${clip.clipIndex} of episode ${episode.episodeIndex} missing hook`);
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/consistency.test.js`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/consistency.js tests/consistency.test.js
git commit -m "feat: hook-density consistency check at clip level"
```

### Task 14: `enrichment.js` — `countChars` for CN replaces `countWords`

**Files:**
- Modify: `src/enrichment.js`
- Modify: `tests/enrichment.test.js`
- Modify: callers (`src/worker.js`, `src/drama-writer.js`)

- [ ] **Step 1: Update tests**

Replace `countWords` tests with `countChars` tests:

```js
describe('countChars', () => {
  test('counts only CN characters, ignoring punctuation and ASCII', async () => {
    const { countChars } = await import('../src/enrichment.js');
    assert.equal(countChars('你好，world！这是测试。'), 6);  // 你好这是测试
  });

  test('returns 0 for empty string', async () => {
    const { countChars } = await import('../src/enrichment.js');
    assert.equal(countChars(''), 0);
  });

  test('handles mixed CN/EN/punctuation', async () => {
    const { countChars } = await import('../src/enrichment.js');
    assert.equal(countChars('陆衡推开大门'), 6);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/enrichment.test.js`

- [ ] **Step 3: Implement `countChars`**

In `src/enrichment.js`, replace the existing `countWords` export:

```js
export function countChars(s) {
  if (!s) return 0;
  return (s.match(/[一-鿿㐀-䶿]/g) || []).length;
}
```

Search the codebase for `countWords` callers and update them to `countChars`:

```bash
grep -rn "countWords" src/ tests/ bin/
```

For each caller, swap the call. Targets that previously checked words-per-scene now check chars-per-clip via `config.targetCharsPerClip`.

- [ ] **Step 4: Run full test suite**

Run: `npm test 2>&1 | tail -15`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: countWords→countChars (CN char count) for clip-length validation"
```

### Task 15: `compressor.js` — clip-grained compression window

**Files:**
- Modify: `src/compressor.js`
- Modify: `tests/compressor.test.js`

- [ ] **Step 1: Update existing compressor tests for clip vocabulary**

Find scene-keyed inputs in tests/compressor.test.js and update to clip-shaped inputs (`clips:[]` instead of `scenes:[]`, fields `setting/action/dialogue/hook` instead of `content/sceneType`).

- [ ] **Step 2: Update compression window**

Find the constant that controls how many prior scenes are summarized at once. Halve it (e.g., 6 → 3) since clips are ~⅓ the size of scenes.

- [ ] **Step 3: Run tests**

Run: `node --test tests/compressor.test.js`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: compressor operates on clip granularity with smaller window"
```

### Task 16: `collector.js` — add 短剧 trend sources

**Files:**
- Modify: `src/collector.js`
- Modify: `tests/collector.test.js`

- [ ] **Step 1: Identify the source list**

Run: `grep -n "websearch\|webfetch\|searchUrls\|fetchUrls" src/collector.js | head -20`

The collector has an internal list of search queries and direct fetch URLs. Find them.

- [ ] **Step 2: Add 短剧-specific sources**

Append to the existing 30-platform list (do not remove novel platforms — many 短剧 are adapted from novels):

```js
// 短剧 trend sources (added in pivot)
const DUANJU_SEARCH_QUERIES = [
  '抖音热门短剧',
  '红果短剧 排行',
  'ReelShort trending drama',
  '微博热搜 反转剧情',
  '快手 爆款短剧',
];

const DUANJU_FETCH_URLS = [
  'https://www.qutoutiao.net/duanju',
  'https://so.weibo.com/weibo?q=%E7%9F%AD%E5%89%A7',
];
```

Merge these into the existing query/URL pools used by the random sampler. Adjust the sampling logic to oversample 短剧 sources by ~30% in CN mode.

- [ ] **Step 3: Update tests**

If `tests/collector.test.js` asserts on a specific source count or URL list, update assertions to match the new pool size.

- [ ] **Step 4: Run tests**

Run: `node --test tests/collector.test.js`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: collector adds 5 短剧 trend sources alongside novel platforms"
```

---

## Phase 5 — Worker & Uploader

### Task 17: Worker variant labels and resume schemaVersion check

**Files:**
- Modify: `src/worker.js`
- Modify: `tests/worker.test.js` (if it exists)

- [ ] **Step 1: Update VARIANTS array**

In `src/worker.js`, replace the `VARIANTS` constant:

```js
const VARIANTS = [
  { key: 'v1', ending: '爽爆',     label: '爽爆结局' },
  { key: 'v2', ending: '苦尽甘来', label: '苦尽甘来结局' },
  { key: 'v3', ending: '反转',     label: '反转结局' },
];
```

- [ ] **Step 2: Update `loadArtifact` to enforce schemaVersion**

Change `loadArtifact` (currently around line 40) to return `null` if the loaded artifact's `schemaVersion !== 2`:

```js
import { SCHEMA_VERSION } from './constants.js';

function loadArtifact(jobId, filename) {
  const filePath = join(JOBS_DIR, jobId, filename);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data && typeof data === 'object' && data.schemaVersion !== SCHEMA_VERSION) {
      console.log(chalk.yellow(`  [${jobId}] Artifact "${filename}" has schemaVersion=${data.schemaVersion} (expected ${SCHEMA_VERSION}); regenerating`));
      return null;
    }
    return data;
  } catch (err) {
    console.log(chalk.yellow(`  [${jobId}] Artifact "${filename}" is corrupt (${err.message}) — will regenerate`));
    return null;
  }
}
```

- [ ] **Step 3: Update `saveArtifact` to write schemaVersion**

```js
function saveArtifact(jobId, filename, data) {
  const dir = join(JOBS_DIR, jobId);
  const tagged = (data && typeof data === 'object' && !Array.isArray(data))
    ? { schemaVersion: SCHEMA_VERSION, ...data }
    : data;
  writeFileSync(join(dir, filename), JSON.stringify(tagged, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 4: Pass `episodesPerDrama`/`clipsPerEpisode` through `processJob`**

In `processJob`, read these from `options` (falling back to config) and thread into `generateOutline` and `generateDrama` calls:

```js
const episodesPerDrama = options.episodesPerDrama || config.episodesPerDrama || 20;
const clipsPerEpisode = options.clipsPerEpisode || config.clipsPerEpisode || 6;
```

Pass these into `generateOutline({...})` so the outline prompt can substitute them.

- [ ] **Step 5: Update worklog summary**

Find the `summaryLines` array (around line 392). Update its entries:

```js
const summaryLines = [
  `=== Duanju Writer Work Log Summary ===`,
  `Job ID:          ${jobId}`,
  `Title:           ${sampleStory?.title || '(unknown)'}`,
  `Language:        ${lang}`,
  `Genre:           ${genre || '(any)'}`,
  `Trope:           ${style || '(default)'}`,
  `Episodes:        ${episodesPerDrama}`,
  `Clips/episode:   ${clipsPerEpisode}`,
  `Total clips:     ${totalClipsWritten}`,
  // ...preserve other existing lines (LLM stats, duration, etc.)
];
```

(`totalClipsWritten` accumulates across all variants. If the existing variable was named `totalScenesWritten`, the rename in Task 5 already covered it.)

- [ ] **Step 6: Run tests**

Run: `npm test 2>&1 | tail -15`

- [ ] **Step 7: Commit**

```bash
git add src/worker.js
git commit -m "feat: worker uses 爽爆/苦尽甘来/反转 variants and schemaVersion-tagged artifacts"
```

### Task 18: Uploader — new payload shape

**Files:**
- Modify: `src/uploader.js`
- Modify: `tests/uploader.test.js`
- Reference: spec §5

- [ ] **Step 1: Update tests in `tests/uploader.test.js`**

```js
test('buildRequest emits format:duanju with new fields', () => {
  const drama = {
    title: '战神归来',
    synopsis: 's',
    trope: '战神归来',
    genre: '都市',
    tags: ['复仇'],
    lang: 'cn',
    characters: [{ name: '陆衡', role: 'p', description: 'd' }],
    episodes: [
      { episodeIndex: 0, title: 't', isEnding: false, ending: null,
        clips: [{ clipIndex: 0, setting: 's', action: 'a', dialogue: 'd', hook: 'h', durationSec: 12, isConclusion: false, conclusion: null }] }
    ],
  };
  const config = { autostoryUrl: 'http://x', aiApiKey: 'k', publishOnUpload: true };
  const { url, options } = buildRequest(drama, config, { variationGroupId: 'g1', variationLabel: '爽爆结局' });
  const body = JSON.parse(options.body);

  assert.equal(url, 'http://x/api/ai/stories');  // endpoint unchanged
  assert.equal(body.format, 'duanju');
  assert.equal(body.trope, '战神归来');
  assert.equal(body.genre, '都市');
  assert.equal(body.lang, 'cn');
  assert.equal(body.episodes[0].clips.length, 1);
  assert.equal(body.episodes[0].scenes, undefined);  // renamed
  assert.equal(body.variationGroupId, 'g1');
  assert.equal(body.variationLabel, '爽爆结局');
  assert.equal(body.publish, true);
});

test('buildRequest does not strip episodeChoices (no longer generated)', () => {
  // Ensure no error if episodeChoices is absent
  const drama = { episodes: [{ episodeIndex: 0, isEnding: false, clips: [] }] };
  const config = { autostoryUrl: 'http://x', aiApiKey: 'k' };
  const { options } = buildRequest(drama, config);
  const body = JSON.parse(options.body);
  assert.equal(Array.isArray(body.episodes), true);
});
```

Update existing uploader tests that asserted on the old payload shape (`scenes`, `episodeChoices` strip, etc.) — replace with the new shape.

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/uploader.test.js`

- [ ] **Step 3: Rewrite `buildRequest` in `src/uploader.js`**

Replace the function body:

```js
export function buildRequest(drama, config, variationOptions = {}) {
  const url = `${config.autostoryUrl}/api/ai/stories`;
  // Deep-copy episodes to avoid mutating the original
  const body = {
    format: 'duanju',
    title: drama.title,
    synopsis: drama.synopsis,
    trope: drama.trope,
    genre: drama.genre,
    tags: drama.tags || [],
    lang: drama.lang || 'cn',
    characters: drama.characters || [],
    episodes: (drama.episodes || []).map(ep => ({
      episodeIndex: ep.episodeIndex,
      title: ep.title,
      isEnding: !!ep.isEnding,
      ending: ep.ending || null,
      clips: (ep.clips || []).map(clip => ({ ...clip })),
    })),
  };

  if (variationOptions.variationGroupId) body.variationGroupId = variationOptions.variationGroupId;
  if (variationOptions.variationLabel) body.variationLabel = variationOptions.variationLabel;
  if (config.publishOnUpload !== undefined) body.publish = config.publishOnUpload;

  const timeoutMs = Number.isFinite(config.uploadTimeout) && config.uploadTimeout > 0
    ? config.uploadTimeout
    : DEFAULT_UPLOAD_TIMEOUT_MS;

  return {
    url,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.aiApiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
    timeoutMs,
  };
}
```

- [ ] **Step 4: Run tests pass**

Run: `node --test tests/uploader.test.js && npm test 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add src/uploader.js tests/uploader.test.js
git commit -m "feat: uploader emits format:duanju payload with clips, trope, genre, characters"
```

---

## Phase 6 — Prompt Rewrites

Each task in this phase rewrites one prompt file and may need to delete its English sibling. Order matters to avoid filename collisions: **delete the English version first**, then rename the Chinese version.

### Task 19: Rewrite `prompts/clips.md`

**Files:**
- Delete: `prompts/scenes.md` (English version, if not deleted from earlier sweep — verify)
- Replace: `prompts/clips.md` (was already created as a stub in Task 10; full rewrite now)
- Reference: spec §4.2 for `clips.md` constraints; §2.3 for the schema the prompt's output must satisfy

- [ ] **Step 1: Delete English scenes prompt**

```bash
[ -f prompts/scenes.md ] && git rm prompts/scenes.md || echo "already deleted"
```

- [ ] **Step 2: Rewrite `prompts/clips.md`**

Replace the stub with a full prompt. The prompt MUST:

1. Open with role framing ("你是短剧编剧"); state that one clip = 10–15 seconds.
2. Include all template placeholders the loader substitutes: `{{title}}`, `{{synopsis}}`, `{{characters}}`, `{{episodeTitle}}`, `{{episodeIndex}}`, `{{clipIndex}}`, `{{totalClips}}`, `{{clipSummary}}`, `{{isConclusion}}`, `{{priorClipDigest}}`, `{{tropeSection}}`, `{{referenceCharacter}}`, `{{referenceEvent}}`.
3. Specify the output JSON schema verbatim from spec §2.3 (clip shape with all fields).
4. Bake in the 4 length constraints in CN chars: `setting≤20`, `action≤80`, `dialogue≤60`, `hook≤30`.
5. State explicitly: every non-conclusion clip must have a non-empty `hook`. Conclusion clips must have `conclusion: { type: "DRAMA_END", ending: "爽爆"|"苦尽甘来"|"反转", title, overview }` and may have empty `hook`.
6. Forbid `[player]` blocks and `|voice:xxx` annotations.
7. Provide a hook-pattern library: 突然出现的反派 / 关键身份揭穿 / 意外发现的证据 / 来电响起 / 镜头特写关键道具 / 角色突然倒下 / 错听一句关键话.
8. End with "Return ONLY a single valid JSON object. No markdown fences, no commentary."

Example skeleton (the implementer fleshes out the body):

```markdown
你是短剧编剧。这是一段 10–15 秒的竖屏短剧片段（clip）。

## 故事背景
标题：{{title}}
简介：{{synopsis}}

## 当前位置
集 {{episodeIndex}}：{{episodeTitle}}
片段 {{clipIndex}} / {{totalClips}}
本片段任务：{{clipSummary}}
是否结局片段：{{isConclusion}}

## 上下文记忆
之前片段：{{priorClipDigest}}

## 角色表
{{characters}}

## 类型钩点指南
{{tropeSection}}

## 参考资料（如有）
人物：{{referenceCharacter}}
事件：{{referenceEvent}}

## 输出结构
返回唯一的 JSON 对象，不要 markdown 围栏，不要解释：
（schema from spec §2.3 inlined here）

## 字数硬约束（按中文字符计数）
- setting ≤ 20  - action ≤ 80  - dialogue ≤ 60  - hook ≤ 30

## 钩点要求
非结局片段必须以悬念结尾。可参考钩点模式：
- 突然出现的反派 / 关键身份揭穿 / 意外发现的证据
- 来电响起 / 镜头特写关键道具 / 角色突然倒下 / 错听一句关键话

## 严禁
- 不写 [player] 块  - 不写 |voice:xxx 标记  - 不写多余 markdown
```

- [ ] **Step 3: Run drama-writer tests**

Run: `node --test tests/drama-writer.test.js`
Expected: pass (the prompt is loaded and string-substituted; tests don't validate prose).

- [ ] **Step 4: Commit**

```bash
git add prompts/clips.md
[ ! -f prompts/scenes.md ] && git add -u prompts/scenes.md 2>/dev/null
git commit -m "feat: rewrite prompts/clips.md for 短剧 clip generation"
```

### Task 20: Rewrite and rename `prompts/outline-cn.md → prompts/outline.md`

**Files:**
- Delete: `prompts/outline.md` (English version)
- Rename + rewrite: `prompts/outline-cn.md → prompts/outline.md`
- Reference: spec §2.1, §2.2, §4.2

- [ ] **Step 1: Delete English outline prompt**

```bash
git rm prompts/outline.md
```

- [ ] **Step 2: Rename Chinese outline prompt**

```bash
git mv prompts/outline-cn.md prompts/outline.md
```

- [ ] **Step 3: Rewrite `prompts/outline.md`**

Replace the existing audio-novel content with a 短剧 outline prompt. Required template placeholders: `{{materials}}`, `{{episodesPerDrama}}`, `{{clipsPerEpisode}}`, `{{tropeSection}}`, `{{genre}}`, `{{referenceCharacter}}`, `{{referenceEvent}}`.

The prompt MUST require the LLM to output JSON matching the spec §2.1/§2.2 schema:
- Top-level: `title, synopsis, trope, genre, tags, lang:"cn", characters[3-7], episodes[]`
- Each episode: `episodeIndex, title, isEnding, ending, clipPlan[]` (each clipPlan entry = `{summary, clipType, isConclusion}`)
- Last episode `isEnding: true` with `ending` ∈ {爽爆, 苦尽甘来, 反转}
- No `episodeChoices`, no `characterQuestions` array (or empty)

Bake in 短剧 conventions:
- 第一集前 30 秒必须爆点
- 每集需 1–2 次反转
- 角色身份冲突早早抛出
- 3–7 个语音可分辨的角色名
- {{episodesPerDrama}} 集（默认 20）× {{clipsPerEpisode}} 片段 (默认 6) ≈ 120 片段

- [ ] **Step 4: Update template-loader paths**

Run: `grep -rn "outline-cn\.md\|outline\.md" src/`

In `src/drama-writer.js` (and any caller), change the path from `outline-cn.md` to `outline.md`. Same for any code that branches on `lang === 'cn' ? 'outline-cn' : 'outline'` — collapse to just `outline.md`.

- [ ] **Step 5: Run tests**

Run: `node --test tests/drama-writer.test.js`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rewrite prompts/outline.md for 短剧 series outline (cn-only)"
```

### Task 21: Rewrite and rename `prompts/plan-cn.md → prompts/plan.md`

**Files:**
- Delete: `prompts/plan.md` (English)
- Rename + rewrite: `prompts/plan-cn.md → prompts/plan.md`

- [ ] **Step 1: Delete and rename**

```bash
git rm prompts/plan.md
git mv prompts/plan-cn.md prompts/plan.md
```

- [ ] **Step 2: Rewrite `prompts/plan.md`**

The planner produces a clip-grained plan. Output schema (per `src/planner.js`):
- `events[]` (per-clip plot beats)
- `revelations[]` with `revealInClip` indices (renamed from `revealInScene` in Task 12)
- `characterArcs[]` with five-stage emotional progression
- Trope-specific 伏笔 placement at 1–2 clip resolution

Required placeholders: `{{outline}}`, `{{tropeSection}}`, `{{episodesPerDrama}}`, `{{clipsPerEpisode}}`. The prompt should explicitly state the output is JSON consumed by `parsePlan` in `src/planner.js`.

- [ ] **Step 3: Update loader path**

Run: `grep -n "plan-cn\.md\|plan\.md" src/planner.js`

Change to `plan.md`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/planner.test.js`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rewrite prompts/plan.md for clip-grained 短剧 planning"
```

### Task 22: Rewrite and rename `prompts/snowflake-cn.md → prompts/snowflake.md`

**Files:**
- Delete: `prompts/snowflake.md` (English)
- Rename + rewrite: `prompts/snowflake-cn.md → prompts/snowflake.md`

- [ ] **Step 1: Delete and rename**

```bash
git rm prompts/snowflake.md
git mv prompts/snowflake-cn.md prompts/snowflake.md
```

- [ ] **Step 2: Rewrite `prompts/snowflake.md`**

Four-step structure preserved (核心种子 → 角色动态 → 世界构建 → 情节架构). Step 4 constrained to 短剧 三幕式 proportions: 触发 (前 ~25%) / 升级反转 (中 ~50%) / 最终爆点+结局 (后 ~25%). Required placeholders: `{{materials}}`, `{{tropeSection}}`, `{{genre}}`, `{{episodesPerDrama}}`.

- [ ] **Step 3: Update loader path in `src/snowflake.js`**

Run: `grep -n "snowflake-cn\|snowflake\.md" src/snowflake.js`

Change to `snowflake.md`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/snowflake.test.js`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rewrite prompts/snowflake.md for 短剧 4-step planning"
```

### Task 23: Rewrite and rename `prompts/research-cn.md → prompts/research.md`

**Files:**
- Delete: `prompts/research.md` (English)
- Rename + rewrite: `prompts/research-cn.md → prompts/research.md`

- [ ] **Step 1: Delete and rename**

```bash
git rm prompts/research.md
git mv prompts/research-cn.md prompts/research.md
```

- [ ] **Step 2: Rewrite `prompts/research.md`**

Materials-collection prompt. Now steers toward 短剧-suitable trends: 反转情节, 高浓度冲突, 网络热议事件, 爽点设计. Required placeholders: `{{searchResults}}`, `{{fetchResults}}`, `{{lang}}`. Output: structured `materials` JSON with `topics[]`, `plotHooks[]`, `characterArchetypes[]`, `trendingTropes[]`.

- [ ] **Step 3: Update loader path in `src/collector.js`**

Run: `grep -n "research-cn\|research\.md" src/collector.js`

Change to `research.md`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/collector.test.js`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rewrite prompts/research.md for 短剧 material collection"
```

### Task 24: Rewrite `prompts/tail-outline.md`

**Files:**
- Modify: `prompts/tail-outline.md`

- [ ] **Step 1: Rewrite for new endings**

Replace ending references from `GOOD/BITTERSWEET/SPECIAL` to `爽爆/苦尽甘来/反转`. Update tone for 短剧 (爽爆 = full revenge complete; 苦尽甘来 = bittersweet redemption; 反转 = unexpected twist that recontextualizes everything). Required placeholders unchanged: `{{frontHalfSummary}}`, `{{splitPoint}}`, `{{targetEnding}}`, `{{tailEpisodeCount}}`.

- [ ] **Step 2: Run tail-outline tests**

Run: `node --test tests/drama-writer.test.js`
(parseTailOutline tests from Task 9 should still pass.)

- [ ] **Step 3: Commit**

```bash
git add prompts/tail-outline.md
git commit -m "feat: rewrite tail-outline prompt for 爽爆/苦尽甘来/反转 endings"
```

---

## Phase 7 — Trope Library

### Task 25: Delete the literary-style library

**Files:**
- Delete: `styles/chinese-literary/`, `styles/chinese-scifi/`, `styles/chinese-webnovel/` (entire directories)

- [ ] **Step 1: Verify nothing else imports these style files by path**

Run: `grep -rn "chinese-literary\|chinese-scifi\|chinese-webnovel" src/ tests/ bin/`
Expected: no matches (the registry uses directory listings, not hard-coded paths).

- [ ] **Step 2: Delete**

```bash
git rm -r styles/chinese-literary styles/chinese-scifi styles/chinese-webnovel
```

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | tail -15`
Expected: pass. Style-registry tests should not break since the registry enumerates whatever directories exist; any test asserting on specific style keys (`hemingway`, `moyan`) should be retired in this commit if not already.

If style-registry tests assert on specific style keys, update them to assert "registry returns at least 1 style for any populated category" (a shape test, not a content test).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove literary-style library in preparation for trope library"
```

### Task 26: Create the 30-trope library

**Files:**
- Create: `styles/{都市,复仇,甜宠,古装,家庭,玄幻}/<trope>.md` (30 files)
- Modify: `tests/styles.test.js` (or similar) to assert categories load

- [ ] **Step 1: Create one fully-fleshed trope as the canonical template**

Write `styles/都市/战神归来.md`:

```markdown
---
name: 战神归来
category: 都市
---

## Outline

短剧类型：战神归来。落魄归来主角 + 嫌贫爱富岳父 + 隐忍前妻 + 跋扈反派。

故事核心：
- 主角五年前因被陷害而消失，期间获得军方/商业/江湖最高地位（隐藏身份）。
- 归来时妻子已被迫"改嫁"或被欺负，岳家因主角"无能"而百般刁难。
- 反派（前情敌、商业对手、岳家关系）公开羞辱主角。
- 通过身份层层揭露，逐步打脸所有曾欺辱主角的人。

人物原型：
- 男主：表面落魄，实则身份显赫，沉稳寡言但护短极强。
- 女主：被迫接受现状，但仍念旧情；中途逐渐认清真相。
- 反派：跋扈无脑，每次出场必被打脸。
- 岳父岳母：势利眼，前期欺压主角，后期跪求原谅。

剧情节奏：
- 前 30 秒：主角狼狈现身，岳父羞辱。
- 中段：N 次身份揭露，每次打脸更狠。
- 终局：终极身份揭穿，反派全员跪地，女主泪奔。

爽点设计：
- 装聋作哑——明明听到嘲讽，主角不动声色。
- 扮猪吃老虎——反派以为主角无能，主角随手解决。
- 旧人惊悚——前情敌发现主角真实身份后的绝望表情。
- 道具对比——主角的车/手表/身份卡是反派一辈子达不到的。

## Clip

写战神归来类型的片段时：
- 对白短促，多反问与命令式语气，男主说话尽量精简。
- 男主肢体语言克制：站姿稳定、目光直视、动作幅度小但精准。
- 女主反应特写：眼眶泛红、手指紧握、欲言又止。
- 反派表情夸张：从得意到惊愕到崩溃的三段式。
- 关键道具镜头：身份卡、车钥匙、电话来电、手表。
- 钩点偏好：身份揭露、来电响起、旁人惊呼、反派下跪。
```

- [ ] **Step 2: Create all remaining 29 trope files**

Each file follows the template above. Per file: `---name/category---` frontmatter, `## Outline` block (signature characters, plot pattern, escalation rhythm, scene rhythm), `## Clip` block (dialogue style, body language, camera/prop preferences, hook patterns).

Required files (29 remaining):

```
styles/都市/龙王赘婿.md
styles/都市/重生归来.md
styles/都市/系统流.md
styles/都市/总裁追妻.md
styles/都市/豪门替嫁.md
styles/都市/灰姑娘逆袭.md
styles/都市/真假千金.md
styles/都市/隐藏身份.md
styles/都市/一胎二宝.md
styles/复仇/重生复仇.md
styles/复仇/替身逆袭.md
styles/复仇/校园复仇.md
styles/复仇/商战复仇.md
styles/复仇/婚后撕渣.md
styles/甜宠/校园甜宠.md
styles/甜宠/闪婚甜宠.md
styles/甜宠/双向暗恋.md
styles/甜宠/师兄妹甜宠.md
styles/古装/穿越古代.md
styles/古装/宫斗.md
styles/古装/仙侠修真.md
styles/古装/王爷追妻.md
styles/古装/替嫁王妃.md
styles/家庭/婆媳战争.md
styles/家庭/离婚再爱.md
styles/玄幻/都市修仙.md
styles/玄幻/系统降临.md
styles/玄幻/超能力觉醒.md
```

For each: write a one-paragraph "故事核心" summarizing the dominant plot pattern; list 3–5 character archetypes; describe the escalation pattern; list 3–5 爽点 mechanics; and write a `## Clip` block describing dialogue/body-language/camera/hook preferences specific to that trope.

- [ ] **Step 3: Add a registry-load test**

In `tests/styles.test.js`:

```js
test('trope registry loads all 6 categories', async () => {
  const { listStyles } = await import('../src/styles.js');
  const styles = listStyles();
  const cats = new Set(styles.map(s => s.category));
  for (const expected of ['都市', '复仇', '甜宠', '古装', '家庭', '玄幻']) {
    assert.ok(cats.has(expected), `missing category: ${expected}`);
  }
});

test('战神归来 trope resolves and exposes Outline + Clip sections', async () => {
  const { getStyle } = await import('../src/styles.js');
  const s = getStyle('战神归来');
  assert.equal(s.name, '战神归来');
  assert.equal(s.category, '都市');
  assert.ok(s.outline && s.outline.length > 0);
  assert.ok(s.clip && s.clip.length > 0);
});
```

(If `styles.js` currently exposes `s.scene` for the `## Scene` section, rename to `s.clip` for the `## Clip` section in the registry parser. Update the registry's section-name parsing to look for `## Clip` instead of `## Scene`.)

- [ ] **Step 4: Update `src/styles.js` registry parser**

Find the parser that splits the file by `## Outline` / `## Scene` / etc. Rename the `scene` key to `clip`:

```bash
grep -n "## Scene\|sceneSection\|\.scene\b" src/styles.js
```

Update to `## Clip` and `clip` accordingly.

- [ ] **Step 5: Run all tests**

Run: `npm test 2>&1 | tail -15`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add styles/ src/styles.js tests/styles.test.js
git commit -m "feat: replace literary-style library with 30 短剧 tropes across 6 categories"
```

### Task 27: Update `styles` command output in CLI

**Files:**
- Modify: `bin/duanju-writer.js` (the `case 'styles':` block)

- [ ] **Step 1: Update header text**

Find the `case 'styles':` block (~line 261). Replace `Available writing styles:` with `Available 短剧 tropes:` and the `default — Standard interactive fiction style` line with `default — 让 LLM 自动选择类型`.

- [ ] **Step 2: Update usage hint**

Replace `Usage: duanju-writer run --style sanderson` with `Usage: duanju-writer run --style 战神归来`.

- [ ] **Step 3: Verify**

```bash
node bin/duanju-writer.js styles | head -25
```

Expected: header says "短剧 tropes", lists 6 categories with their tropes.

- [ ] **Step 4: Commit**

```bash
git add bin/duanju-writer.js
git commit -m "feat: styles command lists 短剧 tropes"
```

---

## Phase 8 — Brand Text & Documentation

### Task 28: Brand text rename — AutoStory → Duanju (display only)

**Files:**
- Modify: `src/setup.js`, `src/uploader.js` (comments only), `bin/duanju-writer.js` (help/error text only)

Per spec §8: rename display strings only. Config key `autostoryUrl` and endpoint `/api/ai/stories` stay.

- [ ] **Step 1: Audit user-visible AutoStory mentions**

Run: `grep -rn "AutoStory" src/ bin/ | grep -v autostoryUrl | grep -v "/api/ai/stories"`

- [ ] **Step 2: Replace each match with "Duanju"**

Targeted edits in each file. For `src/setup.js`:
- `console.log(chalk.bold('\nduanju-writer setup\n'));` (already done)
- Replace any `"AutoStory API"`, `"Cannot reach AutoStory API"`, `"AutoStory API URL"` with `"Duanju API"`, `"Cannot reach Duanju API"`, `"Duanju API URL"` respectively.

For `src/uploader.js`:
- The comment "hung AutoStory API" → "hung Duanju API".

For `bin/duanju-writer.js`:
- Any error or help text mentioning "AutoStory" → "Duanju".

- [ ] **Step 3: Verify**

Run: `grep -rn "AutoStory\|autostory" src/ bin/ | grep -v autostoryUrl | grep -v "/api/ai/stories"`
Expected: no matches.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename display strings AutoStory→Duanju (config key + endpoint preserved)"
```

### Task 29: README rewrite

**Files:**
- Modify: `README.md`

The current README is the audio-novel pitch. Rewrite for 短剧.

- [ ] **Step 1: Rewrite top-of-file pitch**

Replace the first ~50 lines (heading, taglines, badges) with:

```markdown
<div align="center">

# Duanju Writer

### 自动化中文短剧剧本生成器

**调研 · 雪花 · 大纲 · 写作 · 发布**

一个 AI 驱动的守护进程，从全网抓取短剧热点和素材，自动生成中文竖屏短剧（短视频每段 10–15 秒），并发布至 Duanju 平台。

[![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---
```

- [ ] **Step 2: Rewrite the feature list**

Replace the "核心特性" / "Core Features" section with feature bullets reflecting:
- 30 题材库 (短剧 tropes across 6 categories)
- 10–15 秒片段，结构化剧本（setting / action / dialogue / hook）
- 三结局变体（爽爆 / 苦尽甘来 / 反转）
- 默认 20 集 × 6 片段 ≈ 120 片段每剧
- 多模型供应商（Claude CLI、OpenAI、自定义）
- 知识库 + 角色/事件参考资料
- 断点续传、并发任务

- [ ] **Step 3: Rewrite the command reference**

In the CLI table, update example commands:
- `duanju-writer run --style 战神归来 --type 都市`
- `duanju-writer run --style 重生复仇 --episodes 25 --clips-per-episode 5`
- `duanju-writer styles` lists tropes

Remove the bilingual section. Keep only the Chinese version.

- [ ] **Step 4: Update the project-structure block**

Update the file tree to reflect renamed files (`drama-writer.js`, `clip-types.js`, `drama-state.js`, `prompts/clips.md`, etc.).

- [ ] **Step 5: Verify no AutoStory display references remain in README**

Run: `grep -n "AutoStory\|Story Writer\|story-writer\|audio novel\|audio-novel" README.md`
Expected: no matches (all already converted to Duanju / Duanju Writer / duanju-writer / 短剧 in earlier renames).

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for 短剧 product"
```

---

## Phase 9 — Final Validation

### Task 30: Manual end-to-end validation

**Files:** none (validation only)

- [ ] **Step 1: Full test suite green**

Run: `npm test 2>&1 | tail -25`
Expected: all tests pass except the 1 pre-existing flake (`tests/llm.test.js:59`). Capture the output.

- [ ] **Step 2: Static cleanliness sweep**

Run all of these and expect zero matches outside the documented exceptions:

```bash
# Old vocabulary should be gone except in docs/specs and the API endpoint path
grep -rn "parseScene\|buildScenePrompt\|sceneIndex\|nextSceneIndex\|sceneType\|scenePlan\|STORY_END" src/ tests/ bin/ prompts/

# English prompts should be deleted
ls prompts/ | grep -E "^(scenes|outline|plan|research|snowflake)\.md$" | grep -v -E "^(scenes|outline|plan|research|snowflake)-cn\.md$"
# Expected: outline.md, plan.md, research.md, snowflake.md should exist (CN renamed without suffix). scenes.md should NOT exist (renamed to clips.md).

# Old endings should be gone
grep -rn "BITTERSWEET\|SPECIAL.*ending\|GOOD.*ending" src/ tests/ prompts/

# Old config keys
grep -rn "novelType\|targetWordsPerScene" src/ tests/ bin/ | grep -v "rename"
```

- [ ] **Step 3: Stub-config dry run (optional)**

```bash
node bin/duanju-writer.js styles | head -30
node bin/duanju-writer.js config
node bin/duanju-writer.js config set genre 都市
node bin/duanju-writer.js config set style 战神归来
node bin/duanju-writer.js config set novelType 都市  # expect rename hint
node bin/duanju-writer.js run --episodes 5            # expect range error
node bin/duanju-writer.js run --lang en               # expect cn-only error
```

- [ ] **Step 4: Real-LLM end-to-end (one drama)**

If a provider is configured (`duanju-writer config` shows aiApiKey or providers.openai.apiKey set):

```bash
duanju-writer run 1 --style 战神归来 --type 都市 --episodes 20 --clips-per-episode 6
```

Inspect `~/.duanju-writer/jobs/<jobId>/`:
- `outline.json` — 20 episodes, last `isEnding: true`, ending in {爽爆, 苦尽甘来, 反转}, 3–7 characters, schemaVersion 2.
- `clips.json` (or per-variant `clips_v1.json` etc.) — every non-conclusion clip has a non-empty `hook`, char counts respected (sample 5 random clips).
- Upload body shape (intercept by pointing autostoryUrl at a deliberately-failing test endpoint and reading the error log).

If no provider is configured, skip Step 4 and document this manual gate as deferred to first real run.

- [ ] **Step 5: Bump pre-existing flake count if it changed**

If the `tests/llm.test.js:59` flake started passing or new flakes appeared, investigate. Otherwise, accept the suite state.

- [ ] **Step 6: Final commit (if any cleanup needed)**

```bash
git add -A
git status  # verify clean
```

If clean, no final commit needed. If anything was tweaked during validation, commit with `chore: post-validation cleanup`.

---

## Self-Review Notes (filled by author)

**Spec coverage:** Each spec section maps to tasks:

| Spec § | Task(s) |
|---|---|
| §1 Goal & architecture | Task 1 (version/schema), Tasks 2–5 (vocab rename) |
| §2 Data model | Tasks 7–10 (parsers + builders) |
| §3 Pipeline & module changes | Tasks 11–17 (per-module updates) |
| §4 Prompt rewrites + trope library | Tasks 19–27 (one per file) |
| §5 AutoStory payload + uploader | Task 18 |
| §6 CLI surface, config, breaking changes | Task 6, Task 17 (resume), Task 27 (`styles` cmd) |
| §7 Testing | Tests embedded in every relevant task; final gate Task 30 |
| §8 Brand text rename | Task 28 |

**Placeholder scan:** None of the steps say "TBD" or "appropriate". Prompt-rewrite tasks (19–24) describe schema requirements + a structural skeleton; the prose body is the deliverable produced *by* completing the parser tests, not pre-authored in the plan. Trope library task (26) gives one fully-written canonical template (战神归来) and a name list; the engineer fills out 29 more files following the template — this is content production, not pseudo-code.

**Type consistency:** `parseClip`, `buildClipPrompt`, `buildFallbackClip`, `buildRetryClipPrompt`, `clipPlan`, `clipIndex`, `nextClipIndex`, `clips[]` used uniformly. `VALID_ENDINGS` and `VALID_TAIL_ENDINGS` both expose the same 3 values. `SCHEMA_VERSION = 2` referenced by name in worker artifact tasks.

**Spec gaps found and addressed:** Schema-version mechanics were vague in §6.4 of the spec; pinned during spec self-review to a `schemaVersion: 2` field. The plan implements it in Task 17 (worker.js). No additional gaps found.
