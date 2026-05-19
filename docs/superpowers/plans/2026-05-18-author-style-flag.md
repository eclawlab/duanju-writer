# `--author-style` Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the 15 deleted Chinese-author writing-style files and expose them through a new, independent `--author-style` flag that injects prose voice into clip generation only.

**Architecture:** Restore the author `.md` files verbatim into a new `author-styles/` tree. Add a standalone loader `src/author-styles.js` (structural twin of `src/styles.js`) that reads only the `## Scene` block. Thread a new `authorStyle` string param through CLI → config → queue → scheduler → worker → `generateDrama`, where it resolves to an `authorVoice` string appended to the clip and retry-clip prompts. Fully orthogonal to `--style`/`--story`; no mutual-exclusion checks.

**Tech Stack:** Node.js (ESM, `type: module`), `node:test` runner, no external test deps.

**Spec:** `docs/superpowers/specs/2026-05-18-author-style-flag-design.md`

**Conventions observed in this codebase:**
- Tests: `node --test tests/*.test.js`; single file: `node --test tests/<file>.test.js`. Imports use `import { test, describe } from 'node:test'` and `import assert from 'node:assert/strict'`.
- CLI tests shell out via `execFileSync('node', [BIN, ...args])` and assert on exit code + combined stdout/stderr.
- Commit message trailer required on every commit:
  `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- Current branch is `feat/modify-improve-mode`; commit there (do not branch/push unless asked).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `author-styles/<category>/*.md` (15, new) | Restored author voice definitions; data only. |
| `src/author-styles.js` (new) | Load/parse/lookup author styles. One responsibility: author-voice registry. |
| `tests/author-styles.test.js` (new) | Unit tests for the loader. |
| `src/drama-writer.js` (modify) | Resolve `authorVoice`; append voice block in `buildClipPrompt` + `buildRetryClipPrompt`; thread `authorStyle` through `generateDrama`. |
| `src/config.js` (modify) | `authorStyle: ''` default. |
| `src/queue.js` (modify) | Persist `authorStyle` on job record. |
| `src/scheduler.js` (modify) | Pass `authorStyle` from config into scheduled jobs. |
| `src/worker.js` (modify) | Resolve + thread `authorStyle`; job-record retry options; run summary line. |
| `bin/duanju-writer.js` (modify) | Parse/validate `--author-style`; `createJob`/`runOnce` args; `VALID_KEYS`; `author-styles` subcommand; help/usage strings. |
| `tests/cli-flags.test.js` (modify) | CLI acceptance + orthogonality regression. |
| `tests/drama-writer.test.js` (modify) | Prompt-injection unit tests. |
| `README.md` (modify) | Document the flag and subcommand. |

---

## Task 1: Restore the 15 author files

**Files:**
- Create: `author-styles/chinese-literary/{jinyong,laoshe,luxun,moyan,sanmao,shencongwen,wangxiaobo,yuhua,zhangailing}.md`
- Create: `author-styles/chinese-scifi/liucixin.md`
- Create: `author-styles/chinese-webnovel/{ergen,maoni,priest,tangjiasanshao,tiancantudou}.md`

- [ ] **Step 1: Restore all 15 files verbatim from the pre-deletion commit**

The files existed at `styles/chinese-*/` in commit `6ca6906~1`. Restore each to the new `author-styles/` path with content unchanged:

```bash
mkdir -p author-styles/chinese-literary author-styles/chinese-scifi author-styles/chinese-webnovel
for f in jinyong laoshe luxun moyan sanmao shencongwen wangxiaobo yuhua zhangailing; do
  git show "6ca6906~1:styles/chinese-literary/$f.md" > "author-styles/chinese-literary/$f.md"
done
git show "6ca6906~1:styles/chinese-scifi/liucixin.md" > "author-styles/chinese-scifi/liucixin.md"
for f in ergen maoni priest tangjiasanshao tiancantudou; do
  git show "6ca6906~1:styles/chinese-webnovel/$f.md" > "author-styles/chinese-webnovel/$f.md"
done
```

- [ ] **Step 2: Verify count and that each has frontmatter + `## Scene`**

Run:
```bash
ls author-styles/*/*.md | wc -l
grep -L '## Scene' author-styles/*/*.md || echo "all have ## Scene"
head -5 author-styles/chinese-literary/moyan.md
```
Expected: `15`; then `all have ## Scene`; then the moyan frontmatter (`---`, `name: Mo Yan (莫言)`, `category: chinese-literary`, `---`).

- [ ] **Step 3: Commit**

```bash
git add author-styles
git commit -m "feat: restore 15 Chinese-author style files into author-styles/

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `src/author-styles.js` loader (TDD)

**Files:**
- Test: `tests/author-styles.test.js` (create)
- Create: `src/author-styles.js`

- [ ] **Step 1: Write the failing test**

Create `tests/author-styles.test.js`:

```javascript
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAuthorStyle,
  getAuthorStyleSafe,
  listAuthorStyles,
  clearAuthorStyleCache,
} from '../src/author-styles.js';

describe('author-styles loader', () => {
  beforeEach(() => clearAuthorStyleCache());

  test('lists all 15 restored authors', () => {
    const list = listAuthorStyles();
    assert.equal(list.length, 15);
    const keys = list.map(s => s.key).sort();
    assert.ok(keys.includes('moyan'));
    assert.ok(keys.includes('jinyong'));
    assert.ok(keys.includes('liucixin'));
    assert.ok(keys.includes('priest'));
  });

  test('getAuthorStyle returns the ## Scene block', () => {
    const s = getAuthorStyle('moyan');
    assert.equal(s.name, 'Mo Yan (莫言)');
    assert.equal(s.category, 'chinese-literary');
    assert.match(s.scene, /Mo Yan|magical realism|莫言/i);
    assert.ok(s.scene.length > 0);
  });

  test('getAuthorStyle is case-insensitive', () => {
    assert.equal(getAuthorStyle('MoYan'.toLowerCase()).name, getAuthorStyle('moyan').name);
  });

  test('getAuthorStyle throws with available list on unknown key', () => {
    assert.throws(() => getAuthorStyle('nobody'), /Unknown author style: "nobody"[\s\S]*Available author styles:/);
  });

  test('getAuthorStyle returns null for empty / "default"', () => {
    assert.equal(getAuthorStyle(''), null);
    assert.equal(getAuthorStyle('default'), null);
  });

  test('getAuthorStyleSafe returns null (no throw) on unknown key', () => {
    assert.equal(getAuthorStyleSafe('nobody'), null);
  });

  test('getAuthorStyleSafe returns the style on known key', () => {
    assert.equal(getAuthorStyleSafe('luxun').category, 'chinese-literary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/author-styles.test.js`
Expected: FAIL — `Cannot find module '../src/author-styles.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/author-styles.js`:

```javascript
// Loads Chinese-author prose-voice definitions from .md files in the
// author-styles/ directory. Each .md file has YAML-like frontmatter
// (name, category) and ## Outline / ## Scene sections. Only ## Scene is
// consumed (prose voice for clip generation); ## Outline is ignored.
//
// This module is an intentional structural twin of src/styles.js but is
// kept fully separate so the 短剧 trope system and the author-voice system
// never share state, parsers, or registries.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTHOR_STYLES_DIR = join(__dirname, '..', 'author-styles');

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

function extractSection(body, heading) {
  const re = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(re);
  return match ? match[1].trim() : '';
}

function loadAuthorStylesFromDisk() {
  const styles = {};
  let categories;
  try {
    categories = readdirSync(AUTHOR_STYLES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return styles;
  }

  for (const category of categories) {
    const catDir = join(AUTHOR_STYLES_DIR, category);
    let files;
    try {
      files = readdirSync(catDir).filter(f => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      const key = basename(file, '.md');
      const raw = readFileSync(join(catDir, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const scene = extractSection(body, 'Scene');
      if (!scene) {
        console.warn(`[author-styles] "${key}" has no ## Scene section — it will inject no voice.`);
      }
      styles[key] = {
        name: meta.name || key,
        category: meta.category || category,
        scene,
      };
    }
  }

  return styles;
}

let _cache = null;

function getAuthorStyles() {
  if (!_cache) _cache = loadAuthorStylesFromDisk();
  return _cache;
}

export function clearAuthorStyleCache() {
  _cache = null;
}

export function getAuthorStyle(key) {
  if (!key || key === 'default') return null;
  const styles = getAuthorStyles();
  const style = styles[key.toLowerCase()];
  if (!style) {
    const available = Object.entries(styles)
      .map(([k, v]) => `  ${k} — ${v.name}`)
      .join('\n');
    throw new Error(`Unknown author style: "${key}"\nAvailable author styles:\n${available}`);
  }
  return style;
}

const _warnedMissing = new Set();
export function getAuthorStyleSafe(key) {
  if (!key || key === 'default') return null;
  const styles = getAuthorStyles();
  const style = styles[key.toLowerCase()];
  if (!style) {
    if (!_warnedMissing.has(key)) {
      _warnedMissing.add(key);
      console.warn(`[author-styles] Unknown author style "${key}" — generating without an author voice. Run 'duanju-writer author-styles' to see available options.`);
    }
    return null;
  }
  return style;
}

export function listAuthorStyles() {
  const styles = getAuthorStyles();
  return Object.entries(styles).map(([key, style]) => ({
    key,
    name: style.name,
    category: style.category,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/author-styles.test.js`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/author-styles.js tests/author-styles.test.js
git commit -m "feat: add src/author-styles.js loader for author voices

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Inject author voice into clip prompts + thread through `generateDrama` (TDD)

**Files:**
- Test: `tests/drama-writer.test.js:172-217` (extend) and the `buildRetryClipPrompt` describe (~line 312)
- Modify: `src/drama-writer.js:6` (import), `src/drama-writer.js:531-580` (`buildClipPrompt`), `src/drama-writer.js:803-820` (`buildRetryClipPrompt`), `src/drama-writer.js:945-960` (`generateDrama` options), `src/drama-writer.js:1216-1252` (clip loop)

- [ ] **Step 1: Write the failing tests**

In `tests/drama-writer.test.js`, add these tests inside the same `describe` block that contains `clipCtx()` (after the existing `buildClipPrompt` tests, near line 217):

```javascript
  test('buildClipPrompt injects author voice when authorVoice set', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const c = clipCtx();
    c.authorVoice = 'Dense, sensory prose: smells, textures, magical realism.';
    const p = buildClipPrompt(c);
    assert.match(p, /文风|Author Voice/);
    assert.match(p, /Dense, sensory prose/);
  });

  test('buildClipPrompt omits author-voice block when authorVoice empty', async () => {
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const p = buildClipPrompt(clipCtx());
    assert.ok(!/## 文风 \/ Author Voice/.test(p), 'no voice block when authorVoice unset');
  });

  test('buildRetryClipPrompt carries author voice when set', async () => {
    const { buildRetryClipPrompt } = await import('../src/drama-writer.js');
    const prompt = buildRetryClipPrompt({
      clipSummary: '陆衡推门归来',
      prevError: 'bad',
      authorVoice: 'Magical realism, cyclical narrative echoes.',
    });
    assert.match(prompt, /Magical realism, cyclical narrative echoes/);
  });

  test('buildRetryClipPrompt has no voice line when authorVoice empty', async () => {
    const { buildRetryClipPrompt } = await import('../src/drama-writer.js');
    const prompt = buildRetryClipPrompt({ clipSummary: 'x', prevError: 'y' });
    assert.ok(!/文风（仅影响遣词/.test(prompt));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/drama-writer.test.js`
Expected: FAIL — the 4 new tests fail (`buildClipPrompt`/`buildRetryClipPrompt` don't yet emit the voice block).

- [ ] **Step 3: Add the import**

In `src/drama-writer.js`, directly below line 6 (`import { getStyle, getStyleSafe, listStyles } from './styles.js';`), add:

```javascript
import { getAuthorStyleSafe } from './author-styles.js';
```

- [ ] **Step 4: Destructure `authorVoice` in `buildClipPrompt`**

In `src/drama-writer.js`, in the `buildClipPrompt(ctx)` destructure block (lines 532-549), add `authorVoice = ''` to the destructured list. Change:

```javascript
    mode = 'default',
    lang = 'cn',
  } = ctx || {};
```
to:
```javascript
    mode = 'default',
    lang = 'cn',
    authorVoice = '',
  } = ctx || {};
```

- [ ] **Step 5: Append the voice block in `buildClipPrompt`**

In `src/drama-writer.js`, replace the selftell tail (lines 576-580):

```javascript
  if (mode === 'selftell') {
    rendered += '\n' + buildSelftellDirective(lang, 'clip');
  }

  return rendered;
}
```
with:
```javascript
  if (mode === 'selftell') {
    rendered += '\n' + buildSelftellDirective(lang, 'clip');
  }

  if (authorVoice) {
    rendered += '\n\n## 文风 / Author Voice\n\n'
      + '请用以下作家的文风来写作。这只影响遣词、节奏、意象与句子质感——'
      + '不改变剧情、套路结构、人物或事件。\n\n'
      + authorVoice;
  }

  return rendered;
}
```

- [ ] **Step 6: Carry `authorVoice` through `buildRetryClipPrompt`**

In `src/drama-writer.js`, in `buildRetryClipPrompt` (line 804), add `authorVoice = ''` to the destructure:

```javascript
  const { clipSummary = '', prevError = '', isConclusion = false, ending = '爽爆', mode = 'default', lang = 'cn', authorVoice = '' } = ctx;
```

Then, replace the selftell push block (lines 814-816):

```javascript
  if (mode === 'selftell') {
    parts.push(buildSelftellDirective(lang, 'clip'));
  }
  return parts.join('\n');
```
with:
```javascript
  if (mode === 'selftell') {
    parts.push(buildSelftellDirective(lang, 'clip'));
  }
  if (authorVoice) {
    parts.push('文风（仅影响遣词、节奏与意象，不改变剧情、人物或事件）：\n' + authorVoice);
  }
  return parts.join('\n');
```

- [ ] **Step 7: Run the prompt tests to verify they pass**

Run: `node --test tests/drama-writer.test.js`
Expected: PASS — all `drama-writer` tests pass, including the 4 new ones and the unchanged existing prompt tests.

- [ ] **Step 8: Thread `authorStyle` → `authorVoice` through `generateDrama`**

In `src/drama-writer.js`, in `generateDrama` (after line 953 `const mode = options.mode || 'default';`), add:

```javascript
  const authorStyle = options.authorStyle || '';
  const authorVoice = getAuthorStyleSafe(authorStyle)?.scene || '';
```

In the clip-generation loop, add `authorVoice` to the `generateClip({ ... })` call (the object at lines 1223-1240, alongside `mode, lang`):

```javascript
          mode,
          lang,
          authorVoice,
        });
```

And add `authorVoice` to the `buildRetryClipPrompt({ ... })` call (the object at lines 1251-1253, alongside `mode, lang`):

```javascript
            mode,
            lang,
            authorVoice,
          });
```

- [ ] **Step 9: Run the full drama-writer suite to verify nothing regressed**

Run: `node --test tests/drama-writer.test.js`
Expected: PASS — entire file passes (no behavior change when `authorStyle`/`authorVoice` unset).

- [ ] **Step 10: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: inject author voice into clip + retry-clip prompts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: CLI flag, validation, subcommand, help text (TDD)

**Files:**
- Test: `tests/cli-flags.test.js` (extend, inside the `describe('cli flag validation', ...)` block)
- Modify: `bin/duanju-writer.js:127` (arg var), `:181-184` (arg parse), `:291-298` (validate), `:321-323` (createJob/runOnce), `:454-459` (`VALID_KEYS`), `:507` (new `author-styles` case), `:755-756` (help/usage)

- [ ] **Step 1: Write the failing tests**

In `tests/cli-flags.test.js`, add inside the `describe('cli flag validation', ...)` block:

```javascript
  test('--author-style with unknown key is rejected with available list', () => {
    const r = runCli(['run', '--author-style', 'nobody']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Unknown author style: "nobody"/);
    assert.match(r.out, /Available author styles:/);
  });

  test('author-styles subcommand lists the 15 authors', () => {
    const r = runCli(['author-styles']);
    assert.equal(r.code, 0);
    assert.match(r.out, /moyan/);
    assert.match(r.out, /chinese-literary/);
  });

  test('config set rejects unknown key but accepts authorStyle', () => {
    const r = runCli(['config', 'set', 'authorStyle', 'moyan']);
    assert.equal(r.code, 0);
    assert.match(r.out, /authorStyle/);
  });
```

> Note on the third test: `config set <key> <value>` mutates the on-disk config. The existing `tests/cli-flags.test.js` already exercises real CLI side effects this way; follow the file's existing pattern. If the file already has a `config set` test, place this assertion next to it and reset the key afterward with `runCli(['config', 'set', 'authorStyle', ''])`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cli-flags.test.js`
Expected: FAIL — unknown `--author-style` is not rejected; `author-styles` is an unknown command; `authorStyle` not in `VALID_KEYS`.

- [ ] **Step 3: Declare the arg variable**

In `bin/duanju-writer.js`, after line 127 (`let mode;`), add:

```javascript
    let authorStyle;
```

- [ ] **Step 4: Parse `--author-style`**

In `bin/duanju-writer.js`, in the `run` arg loop, directly after the `--mode` branch (ends line 184 `a++;` then `}`), add a new `else if` branch:

```javascript
      } else if (args[a] === '--author-style' && args[a + 1]) {
        authorStyle = args[a + 1];
        a++;
```

(Insert it as `} else if (...) {` immediately before the existing `} else if (args[a].trim() !== '' && !args[a].startsWith('-')) {` positional-count branch.)

- [ ] **Step 5: Validate before creating jobs**

In `bin/duanju-writer.js`, immediately after the trope-style validation block (lines 291-298, the `// Validate style before creating any jobs` block ending with its closing `}`), add:

```javascript
    // Validate author style before creating any jobs (orthogonal to --style).
    if (authorStyle && authorStyle !== 'default') {
      const { getAuthorStyle } = await import('../src/author-styles.js');
      try {
        getAuthorStyle(authorStyle);
      } catch (err) {
        console.log(err.message);
        process.exit(1);
      }
    }
```

- [ ] **Step 6: Pass into createJob / runOnce**

In `bin/duanju-writer.js`, lines 321 and 323, add `authorStyle` to both option objects:

```javascript
      const job = createJob({ lang, style, genre, newsUrl, referenceCharacter, referenceEvent, referenceStory, fidelity, episodesPerDrama, clipsPerEpisode, mode, authorStyle });
      console.log(`\n[${i + 1}/${count}] Created job ${job.id}`);
      await runOnce(job.id, { lang, style, genre, newsUrl, referenceCharacter, referenceEvent, referenceStory, fidelity, episodesPerDrama, clipsPerEpisode, mode, authorStyle });
```

- [ ] **Step 7: Add `authorStyle` to config `VALID_KEYS`**

In `bin/duanju-writer.js`, the `VALID_KEYS` array (lines 454-459) — add `'authorStyle'` to the last line:

```javascript
      'targetCharsPerClip', 'episodesPerDrama', 'clipsPerEpisode',
      'mode', 'authorStyle',
    ];
```

- [ ] **Step 8: Add the `author-styles` subcommand**

In `bin/duanju-writer.js`, immediately before the `case 'styles': {` line (line 507), add:

```javascript
  case 'author-styles': {
    const { listAuthorStyles } = await import('../src/author-styles.js');
    const styles = listAuthorStyles();
    const byCategory = new Map();
    for (const s of styles) {
      const cat = s.category || 'other';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(s);
    }
    console.log('Available author voices (--author-style):\n');
    console.log('  default — no author voice (plot/trope only)\n');
    for (const [category, items] of byCategory) {
      console.log(`  [${category}]`);
      for (const s of items) {
        console.log(`    ${s.key} — ${s.name}`);
      }
      console.log();
    }
    console.log('Usage: duanju-writer run --author-style moyan');
    console.log('Note: orthogonal to --style and --story (can be combined).');
    break;
  }
```

- [ ] **Step 9: Update help / usage strings**

In `bin/duanju-writer.js`, the top-level usage line (line 755), add `author-styles` to the subcommand list:

```javascript
    console.log('Usage: duanju-writer [setup|start|scheduler|worker|run|modify|stories|jobs|styles|author-styles|config|provider|role|knowledge|resume]');
```

And the run-options line (line 756) — append `[--author-style <key>]` before the closing backtick:

```javascript
    console.log('\nRun options: duanju-writer run [count] [--lang cn] [--style 战神归来] [--type 都市] [--news URL] [--story path.{txt,md}] [--fidelity tight|medium|loose] [--character path.md] [--event path.md] [--model claude|openai] [--episodes N] [--clips-per-episode K] [--mode default|selftell] [--author-style <key>]');
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `node --test tests/cli-flags.test.js`
Expected: PASS — including the 3 new tests.

- [ ] **Step 11: Commit**

```bash
git add bin/duanju-writer.js tests/cli-flags.test.js
git commit -m "feat: --author-style CLI flag, validation, author-styles subcommand

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Plumbing — config / queue / scheduler / worker (TDD)

**Files:**
- Test: `tests/queue.test.js` (extend) and `tests/cli-flags.test.js` (orthogonality regression)
- Modify: `src/config.js:23` (DEFAULTS), `src/queue.js:140` (job record), `src/scheduler.js:82` (scheduled options), `src/worker.js:265` (resolve), `:435` & `:599` (`generateDrama` calls), `:742` (summary), `:879` (retry options)

- [ ] **Step 1: Write the failing test (queue persistence)**

In `tests/queue.test.js`, find the existing `createJob` test that asserts persisted `options` and add an assertion (or add a focused test mirroring the existing style — check the file's `createJob`/`options.mode` pattern first and copy it):

```javascript
  test('createJob persists authorStyle on the job record', async () => {
    const { createJob } = await import('../src/queue.js');
    const job = createJob({ authorStyle: 'moyan' });
    assert.equal(job.options.authorStyle, 'moyan');
  });

  test('createJob defaults authorStyle to null when absent', async () => {
    const { createJob } = await import('../src/queue.js');
    const job = createJob({});
    assert.equal(job.options.authorStyle, null);
  });
```

> Before writing, open `tests/queue.test.js` and match its existing setup (temp jobs dir / `JOBS_FILE` env, imports). Reuse the file's existing helpers rather than inventing new ones.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/queue.test.js`
Expected: FAIL — `job.options.authorStyle` is `undefined` (key not persisted).

- [ ] **Step 3: Add the config default**

In `src/config.js`, in `DEFAULTS`, directly after line 23 (`style: 'default',`) add:

```javascript
  authorStyle: '',
```

- [ ] **Step 4: Persist on the job record**

In `src/queue.js`, in the `options` object of the job record (lines 131-141), after the `mode: options.mode ?? null,` line add:

```javascript
        authorStyle: options.authorStyle ?? null,
```

- [ ] **Step 5: Run queue test to verify pass**

Run: `node --test tests/queue.test.js`
Expected: PASS — both new assertions pass.

- [ ] **Step 6: Pass from scheduler config**

In `src/scheduler.js`, in the `options` object (lines 70-86), after `mode: config.mode || undefined,` add:

```javascript
    authorStyle: config.authorStyle || undefined,
```

- [ ] **Step 7: Resolve in worker**

In `src/worker.js`, directly after line 265 (`const mode = options.mode || config.mode || 'default';`) add:

```javascript
  const authorStyle = options.authorStyle || config.authorStyle || '';
```

- [ ] **Step 8: Thread into both `generateDrama` calls**

In `src/worker.js`, the front-story call (line 435) — add `authorStyle` to the options object:

```javascript
        lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, style, mode, authorStyle, log, wlog,
```

And the tail-variant call (line 599) — same addition:

```javascript
          lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, style, mode, authorStyle, log, wlog,
```

- [ ] **Step 9: Add to run summary + job-record retry options**

In `src/worker.js`, the summary block — after line 742 (`` `Trope:           ${style}`, ``) add:

```javascript
      `Author voice:    ${authorStyle || '(none)'}`,
```

In the daemon retry-options object (lines 869-880), after `mode: opts.mode || undefined,` add:

```javascript
          authorStyle: opts.authorStyle || undefined,
```

Also add `authorStyle` to the `wlog('job_start', { ... })` payload (lines 273-278), after `mode,`:

```javascript
    authorStyle: authorStyle || '(none)',
```

- [ ] **Step 10: Write the orthogonality regression test**

In `tests/cli-flags.test.js`, add inside the `describe` block. These assert the CLI does NOT reject the combinations (it will proceed past validation; we only check that the *specific* mutual-exclusion / unknown-author errors are absent):

```javascript
  test('--author-style is accepted together with --style (orthogonal)', () => {
    const r = runCli(['run', '--style', '战神归来', '--author-style', 'moyan', '--dry-run-validate-only']);
    // No mutual-exclusion or unknown-key error for this combination.
    assert.ok(!/mutually exclusive/i.test(r.out), r.out);
    assert.ok(!/Unknown author style/.test(r.out), r.out);
  });

  test('--author-style is accepted together with --story (orthogonal)', () => {
    const r = runCli(['run', '--story', 'tests/fixtures/does-not-exist.txt', '--author-style', 'moyan']);
    // It will fail on the missing --story file, NOT on an author/style conflict.
    assert.ok(!/mutually exclusive/i.test(r.out), r.out);
    assert.ok(!/Unknown author style/.test(r.out), r.out);
  });
```

> `--dry-run-validate-only` is NOT a real flag — it is an unknown token the arg loop ignores, letting validation run without starting a job. If `runCli(['run', ...])` would actually start generating, instead assert only on the `--story` test (which exits early on the missing file) and drop the first test's run, keeping only its intent as a comment. Verify behavior when implementing: run `node bin/duanju-writer.js run --style 战神归来 --author-style moyan` manually and confirm it does not print a mutual-exclusion/unknown-author error before any LLM call. Adjust the test to assert on whatever early, deterministic output proves the combination was accepted (e.g. the job-creation line) without performing a full generation.

- [ ] **Step 11: Run the full test suite**

Run: `node --test tests/*.test.js`
Expected: PASS — entire suite green (existing + new). Investigate any failure before continuing; do not mark complete with red tests.

- [ ] **Step 12: Commit**

```bash
git add src/config.js src/queue.js src/scheduler.js src/worker.js tests/queue.test.js tests/cli-flags.test.js
git commit -m "feat: thread authorStyle through config/queue/scheduler/worker

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the flag and subcommand**

In `README.md`, locate the options table that contains the `--style <套路名>` row (around line 151) and add a row after it:

```
| `--author-style <key>` | 叠加指定中文作家文风（仅影响文笔，与 `--style`/`--story` 正交可叠加）；`duanju-writer author-styles` 查看 15 位作家 |
```

And in the subcommand list that contains `duanju-writer styles`, add a line after it:

```
duanju-writer author-styles  列出 15 位作家文风
```

(Match the surrounding table/list formatting exactly; if the README structure differs from these snippets, adapt the wording to the existing format but keep the facts: new `--author-style` flag, orthogonal to `--style`/`--story`, 15 authors, `author-styles` listing subcommand.)

- [ ] **Step 2: Manual smoke check of the subcommand**

Run: `node bin/duanju-writer.js author-styles`
Expected: prints the 3 categories with 15 keys total (9 chinese-literary, 1 chinese-scifi, 5 chinese-webnovel) and the usage/orthogonality note.

- [ ] **Step 3: Full suite final run**

Run: `node --test tests/*.test.js`
Expected: PASS — full suite green.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document --author-style flag and author-styles subcommand

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Restore 15 files verbatim → Task 1.
- `src/author-styles.js` loader (getAuthorStyle/Safe/list/clearCache, `## Scene` only, throws-with-list, warn+null) → Task 2.
- Clip-prose-only injection via append pattern, empty = no-op → Task 3 (steps 4-5); retry-clip parity (selftell precedent) → Task 3 (step 6); `generateDrama` threading both call sites → Task 3 (step 8) + Task 5 (step 8).
- CLI parse/validate/createJob/runOnce/VALID_KEYS/subcommand/help → Task 4.
- config default / queue persist / scheduler / worker resolve+summary+retry-options → Task 5.
- Orthogonality (no mutual-exclusion) → Task 4 (validation block is independent of `--style`/`--story`) + Task 5 step 10 regression tests.
- Error handling: CLI hard-fail (Task 4 step 5), worker graceful `getAuthorStyleSafe` (Task 3 step 8), missing `## Scene` warn (Task 2 step 3 loader), missing dir → `{}` (Task 2 loader `catch`).
- Tests: author-styles (Task 2), cli-flags (Task 4 + 5), drama-writer (Task 3) → matches spec test table.
- README → Task 6.
No spec requirements without a task.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The two "verify behavior when implementing" notes (Task 5 steps 1 & 10) are deliberate test-robustness guidance with concrete fallback instructions, not deferred work.

**Type consistency:** `authorStyle` (string param) and `authorVoice` (resolved `.scene` string) are used consistently across `buildClipPrompt`, `buildRetryClipPrompt`, `generateClip` ctx, `generateDrama` options, queue/scheduler/worker. Loader exports `getAuthorStyle`, `getAuthorStyleSafe`, `listAuthorStyles`, `clearAuthorStyleCache` — same names used in tests and `bin/duanju-writer.js`. `.scene` property name consistent between loader and `generateDrama` resolution.
