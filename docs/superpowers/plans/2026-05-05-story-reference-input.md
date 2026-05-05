# Story-as-Reference Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--story <path>` and `--fidelity tight|medium|loose` flags to `duanju-copier run`, enabling the pipeline to ingest a reference novel, extract a structured story bible + chapter index, and adapt the source into the existing duanju output format.

**Architecture:** New module `src/story-bible.js` owns all novel-handling primitives (chapter splitting, LLM extraction, LLM synthesis, bible compression, prose selection, artifact I/O). Pipeline gains one new front-end phase (`story-extraction`) that runs only when `referenceStory` is set; `research` and `materials` are skipped in that case. Snowflake/outline/plan/clip prompt builders accept optional `bible` + `fidelity` (and clip/plan stages also accept `chapters`) and render new conditional sections. Output format is unchanged.

**Tech Stack:** Node.js ≥ 20, ES modules, `node:test`, existing `llm.js` for LLM calls, existing `saveArtifact`/`loadArtifact` for persistence.

**Spec:** `docs/superpowers/specs/2026-05-05-story-reference-input-design.md`

---

## File map

**New files:**
- `src/story-bible.js` — chapter splitter, extractors, compressors, artifact I/O
- `prompts/story-bible.md` — extraction + synthesis prompts (Chinese)
- `tests/story-bible-split.test.js` — chapter splitter tests
- `tests/story-bible-compress.test.js` — bible compression + prose selection tests
- `tests/story-bible-prompt.test.js` — bible/prose block prompt builder tests
- `tests/story-bible-extract.test.js` — extraction + synthesis tests with mocked LLM

**Modified files:**
- `bin/duanju-copier.js` — flag parsing, validation, help, `VALID_KEYS`
- `src/config.js` — add `referenceStory: ''` and `fidelity: 'medium'` defaults
- `src/queue.js` — persist `referenceStory`, `fidelity` on job records
- `src/scheduler.js` — read `referenceStory` from config like `referenceCharacter`
- `src/worker.js` — invoke `story-extraction` phase, skip research+materials, thread `bible`/`chapters`/`fidelity` through stages, resume support
- `src/snowflake.js` — accept `bible`/`fidelity`, render bible block
- `src/drama-writer.js` — outline accepts `bible`/`fidelity`, validates `sourceChapterRange`; clip generation accepts compressed bible + chapter prose
- `src/planner.js` — accept compressed `bible` + chapter prose + `fidelity`
- `prompts/snowflake.md`, `prompts/outline.md`, `prompts/plan.md`, `prompts/clips.md` — append conditional sections (no template engine; appended programmatically by builders)
- `tests/cli-flags.test.js` — extend with new flag validation cases

---

## Phase 1 — Story bible primitives (pure functions)

### Task 1: Create `src/story-bible.js` with `splitChapters`

**Files:**
- Create: `src/story-bible.js`
- Test: `tests/story-bible-split.test.js`

Splits a novel's raw text into ordered chapter chunks. Tries Chinese (`第N章`, `第N节`), Western (`Chapter N`, also `# Chapter N` markdown), and numeric-only headings (`一、` or `1.`) in priority order, in that order. Falls back to ~3000-char windowed chunks if nothing matches.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/story-bible-split.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('splitChapters', () => {
  test('splits on Chinese 第N章 headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一章 归来\n陆衡推开大门。\n第二章 重逢\n苏晚抬起头。\n第三章 决裂\n两人对视。';
    const result = splitChapters(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].chapterIndex, 1);
    assert.equal(result[0].title, '归来');
    assert.ok(result[0].prose.includes('陆衡推开大门'));
    assert.equal(result[2].title, '决裂');
  });

  test('splits on Chinese 第N节 headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一节 序\n开篇。\n第二节 遇\n相遇。';
    const result = splitChapters(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, '序');
  });

  test('splits on Western Chapter N headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = 'Chapter 1 Return\nHe came back.\nChapter 2 Reunion\nThey met.';
    const result = splitChapters(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Return');
    assert.equal(result[1].title, 'Reunion');
  });

  test('splits on markdown # Chapter N headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '# Chapter 1 Return\nHe came back.\n# Chapter 2 Reunion\nThey met.';
    const result = splitChapters(text);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Return');
  });

  test('falls back to ~3000-char windowed chunks when no headings', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = 'a'.repeat(7500);
    const result = splitChapters(text);
    assert.equal(result.length, 3);
    assert.ok(result[0].prose.length <= 3200);
    assert.ok(result[0].prose.length >= 2800);
    assert.equal(result[0].chapterIndex, 1);
    assert.equal(result[0].title, '');
  });

  test('handles single-chapter input (no heading)', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const result = splitChapters('Short story under 3000 chars.');
    assert.equal(result.length, 1);
    assert.equal(result[0].chapterIndex, 1);
    assert.equal(result[0].prose, 'Short story under 3000 chars.');
  });

  test('throws on empty input', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    assert.throws(() => splitChapters(''), /empty/i);
    assert.throws(() => splitChapters('   \n  \t '), /empty/i);
  });

  test('preserves prose content verbatim across chapters', async () => {
    const { splitChapters } = await import('../src/story-bible.js');
    const text = '第一章 标题\n这是第一段。\n这是第二段。\n第二章 标题二\n第二章内容。';
    const result = splitChapters(text);
    assert.ok(result[0].prose.includes('这是第一段'));
    assert.ok(result[0].prose.includes('这是第二段'));
    assert.ok(!result[0].prose.includes('第二章内容'));
    assert.ok(result[1].prose.includes('第二章内容'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-only --grep "splitChapters"` (or just `npm test 2>&1 | grep -A 1 splitChapters`)
Expected: FAIL with "Cannot find module '../src/story-bible.js'"

- [ ] **Step 3: Implement `src/story-bible.js` with `splitChapters` only**

```javascript
// src/story-bible.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHUNK_SIZE = 3000;

const HEADING_PATTERNS = [
  // Chinese 第N章 / 第N节 — N can be Arabic or Chinese numerals
  { kind: 'cn-chapter', re: /^[ \t]*#{0,6}[ \t]*第[0-9一二三四五六七八九十百千零〇两]+[章节][ \t]*([^\n]*)$/gm },
  // Western Chapter N (with optional markdown prefix)
  { kind: 'en-chapter', re: /^[ \t]*#{0,6}[ \t]*Chapter[ \t]+\d+[ \t.:—-]*([^\n]*)$/gim },
  // Numeric-only headings: "1." or "一、"
  { kind: 'numeric', re: /^[ \t]*#{0,6}[ \t]*(?:\d+\.|[一二三四五六七八九十百]+、)[ \t]*([^\n]*)$/gm },
];

export function splitChapters(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error('splitChapters: input is empty');
  }
  for (const pat of HEADING_PATTERNS) {
    const matches = [...rawText.matchAll(pat.re)];
    if (matches.length >= 1) {
      return matchesToChapters(rawText, matches);
    }
  }
  return windowedChunks(rawText);
}

function matchesToChapters(rawText, matches) {
  const chapters = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headingEnd = m.index + m[0].length;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const prose = rawText.slice(headingEnd, nextStart).trim();
    chapters.push({
      chapterIndex: i + 1,
      title: (m[1] || '').trim(),
      prose,
    });
  }
  return chapters;
}

function windowedChunks(rawText) {
  const out = [];
  let pos = 0;
  let idx = 1;
  while (pos < rawText.length) {
    const slice = rawText.slice(pos, pos + CHUNK_SIZE);
    out.push({ chapterIndex: idx, title: '', prose: slice });
    pos += CHUNK_SIZE;
    idx += 1;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -30`
Expected: All `splitChapters` tests pass; existing test count + 8 new tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/story-bible.js tests/story-bible-split.test.js
git commit -m "feat: add splitChapters for novel chapter detection"
```

---

### Task 2: Add `compressBibleForEpisode` and `selectChapterProse` (pure)

**Files:**
- Modify: `src/story-bible.js` (append two functions)
- Test: `tests/story-bible-compress.test.js`

`compressBibleForEpisode(bible, range)` filters bible to characters/events relevant to a chapter range. `selectChapterProse(chapters, range, budgetChars)` concatenates and truncates prose to fit a budget.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/story-bible-compress.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SAMPLE_BIBLE = {
  schemaVersion: 1,
  title: 'Test',
  logline: 'A man returns.',
  characters: [
    { name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 10 },
    { name: '苏晚', role: 'foil', identity: '前妻', motivation: '寻找真相', arc: '怀疑→相信', firstChapter: 2, lastChapter: 10 },
    { name: '林董', role: 'antagonist', identity: '幕后黑手', motivation: '权力', arc: '掌控→失败', firstChapter: 5, lastChapter: 10 },
    { name: '锁定王', role: 'reference-pinned', identity: '指定角色', motivation: 'x', arc: 'y', firstChapter: 99, lastChapter: 99 },
  ],
  events: [
    { eventIndex: 0, summary: '陆衡归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false },
    { eventIndex: 1, summary: '苏晚识破', chapterRange: [3, 4], actors: ['苏晚', '陆衡'], isTurningPoint: false, isReveal: true },
    { eventIndex: 2, summary: '林董出场', chapterRange: [5, 6], actors: ['林董'], isTurningPoint: true, isReveal: false },
  ],
  hooks: [
    { summary: '戒指特写', chapterRange: [1, 1] },
    { summary: '电话铃响', chapterRange: [4, 4] },
  ],
  themes: ['复仇', '身份认同'],
  world: '现代都市豪门',
  ending: '主角揭穿真相，反派败北。',
};

describe('compressBibleForEpisode', () => {
  test('includes only characters whose [first,last] intersects range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [1, 2]);
    const names = out.characters.map(c => c.name);
    assert.ok(names.includes('陆衡'));
    assert.ok(names.includes('苏晚'));
    assert.ok(!names.includes('林董'));
  });

  test('always includes reference-pinned characters regardless of range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [1, 2]);
    const names = out.characters.map(c => c.name);
    assert.ok(names.includes('锁定王'), 'reference-pinned must always appear');
  });

  test('includes only events whose chapterRange intersects range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [3, 5]);
    const summaries = out.events.map(e => e.summary);
    assert.ok(summaries.includes('苏晚识破'));
    assert.ok(summaries.includes('林董出场'));
    assert.ok(!summaries.includes('陆衡归来'));
  });

  test('always includes logline, themes, world, ending', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [99, 100]);
    assert.equal(out.logline, SAMPLE_BIBLE.logline);
    assert.deepEqual(out.themes, SAMPLE_BIBLE.themes);
    assert.equal(out.world, SAMPLE_BIBLE.world);
    assert.equal(out.ending, SAMPLE_BIBLE.ending);
  });

  test('drops hooks not in range', async () => {
    const { compressBibleForEpisode } = await import('../src/story-bible.js');
    const out = compressBibleForEpisode(SAMPLE_BIBLE, [3, 4]);
    const summaries = out.hooks.map(h => h.summary);
    assert.ok(!summaries.includes('戒指特写'));
    assert.ok(summaries.includes('电话铃响'));
  });
});

describe('selectChapterProse', () => {
  const CHAPTERS = [
    { chapterIndex: 1, title: '一', charCount: 10, prose: 'A'.repeat(10) },
    { chapterIndex: 2, title: '二', charCount: 10, prose: 'B'.repeat(10) },
    { chapterIndex: 3, title: '三', charCount: 10, prose: 'C'.repeat(10) },
  ];

  test('returns concatenated prose when within budget', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const out = selectChapterProse(CHAPTERS, [1, 3], 1000);
    assert.ok(out.includes('AAAAAAAAAA'));
    assert.ok(out.includes('BBBBBBBBBB'));
    assert.ok(out.includes('CCCCCCCCCC'));
    assert.ok(out.includes('章节 1'));
    assert.ok(out.includes('章节 3'));
  });

  test('truncates with head+tail+marker when over budget', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const big = [{ chapterIndex: 1, title: 'big', charCount: 10000, prose: 'X'.repeat(10000) }];
    const out = selectChapterProse(big, [1, 1], 4000);
    assert.ok(out.length <= 4500, `expected <=4500, got ${out.length}`);
    assert.ok(out.includes('省略'));
    assert.ok(out.startsWith(out.slice(0, 100)));
    assert.match(out, /XX+\s*…\[省略 \d+ 字\]…\s*XX+/s);
  });

  test('returns empty string when range is invalid (no overlap)', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const out = selectChapterProse(CHAPTERS, [99, 100], 4000);
    assert.equal(out, '');
  });

  test('handles single-chapter range', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const out = selectChapterProse(CHAPTERS, [2, 2], 4000);
    assert.ok(out.includes('BBBBBBBBBB'));
    assert.ok(!out.includes('AAAAAAAAAA'));
    assert.ok(!out.includes('CCCCCCCCCC'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "compressBibleForEpisode|selectChapterProse" | head`
Expected: FAIL with "compressBibleForEpisode is not a function" / "selectChapterProse is not a function".

- [ ] **Step 3: Implement both functions in `src/story-bible.js`**

Append to `src/story-bible.js`:

```javascript
// ─── Bible compression ────────────────────────────────────────────────────────

/**
 * Filters a bible to entries relevant to a chapter range. Always preserves
 * logline, themes, world, ending, and reference-pinned characters.
 * @param {object} bible
 * @param {[number, number]} range - [startChapter, endChapter] inclusive
 * @returns {object} compressed bible
 */
export function compressBibleForEpisode(bible, range) {
  const [start, end] = range;
  const characters = bible.characters.filter((c) => {
    if (c.role === 'reference-pinned') return true;
    const cs = c.firstChapter ?? 1;
    const ce = c.lastChapter ?? cs;
    return ce >= start && cs <= end;
  });
  const events = bible.events.filter((e) => {
    const [es, ee] = e.chapterRange ?? [0, 0];
    return ee >= start && es <= end;
  });
  const hooks = (bible.hooks ?? []).filter((h) => {
    const [hs, he] = h.chapterRange ?? [0, 0];
    return he >= start && hs <= end;
  });
  return {
    schemaVersion: bible.schemaVersion,
    title: bible.title,
    logline: bible.logline,
    characters,
    events,
    hooks,
    themes: bible.themes,
    world: bible.world,
    ending: bible.ending,
  };
}

// ─── Chapter prose selection ──────────────────────────────────────────────────

/**
 * Concatenates chapter prose for a given range. If the total exceeds budgetChars,
 * truncates with head + ellipsis-marker + tail to fit.
 * @param {Array<{chapterIndex, title, prose}>} chapters
 * @param {[number, number]} range
 * @param {number} budgetChars
 * @returns {string}
 */
export function selectChapterProse(chapters, range, budgetChars) {
  const [start, end] = range;
  const slice = chapters.filter((c) => c.chapterIndex >= start && c.chapterIndex <= end);
  if (slice.length === 0) return '';
  const blocks = slice.map((c) => `【章节 ${c.chapterIndex}：${c.title}】\n${c.prose}`);
  const full = blocks.join('\n\n');
  if (full.length <= budgetChars) return full;
  const halfBudget = Math.floor((budgetChars - 30) / 2);
  const omitted = full.length - 2 * halfBudget;
  return `${full.slice(0, halfBudget)}\n…[省略 ${omitted} 字]…\n${full.slice(-halfBudget)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: All compress + prose-selection tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/story-bible.js tests/story-bible-compress.test.js
git commit -m "feat: add bible compression + chapter prose selection helpers"
```

---

### Task 3: Add artifact I/O — `loadStoryArtifacts` / `saveStoryArtifacts`

**Files:**
- Modify: `src/story-bible.js`
- Test: extend `tests/story-bible-compress.test.js` (or create dedicated)

Persist `bible.json` and `chapters.json` under `<jobDir>/story/`. Schema-version aware: returns `null` on missing or schema mismatch (caller re-extracts).

- [ ] **Step 1: Write the failing tests** — append to `tests/story-bible-compress.test.js`

```javascript
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('loadStoryArtifacts / saveStoryArtifacts', () => {
  test('save then load round-trips bible and chapters', async () => {
    const { saveStoryArtifacts, loadStoryArtifacts } = await import('../src/story-bible.js');
    const dir = mkdtempSync(join(tmpdir(), 'story-test-'));
    try {
      const bible = { schemaVersion: 1, title: 't', logline: 'l', characters: [], events: [], hooks: [], themes: [], world: '', ending: '' };
      const chapters = { schemaVersion: 1, totalChars: 5, chapters: [{ chapterIndex: 1, title: '', charCount: 5, prose: 'hello' }] };
      saveStoryArtifacts(dir, { bible, chapters });
      assert.ok(existsSync(join(dir, 'story', 'bible.json')));
      assert.ok(existsSync(join(dir, 'story', 'chapters.json')));
      const loaded = loadStoryArtifacts(dir);
      assert.deepEqual(loaded.bible, bible);
      assert.deepEqual(loaded.chapters, chapters);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null when artifacts missing', async () => {
    const { loadStoryArtifacts } = await import('../src/story-bible.js');
    const dir = mkdtempSync(join(tmpdir(), 'story-test-'));
    try {
      assert.equal(loadStoryArtifacts(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null on schemaVersion mismatch', async () => {
    const { saveStoryArtifacts, loadStoryArtifacts } = await import('../src/story-bible.js');
    const dir = mkdtempSync(join(tmpdir(), 'story-test-'));
    try {
      saveStoryArtifacts(dir, {
        bible: { schemaVersion: 999, title: '', logline: '', characters: [], events: [], hooks: [], themes: [], world: '', ending: '' },
        chapters: { schemaVersion: 1, totalChars: 0, chapters: [] },
      });
      assert.equal(loadStoryArtifacts(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "loadStoryArtifacts|saveStoryArtifacts" | head`
Expected: FAIL with "is not a function"

- [ ] **Step 3: Implement both functions** — append to `src/story-bible.js`

```javascript
// ─── Artifact I/O ─────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

export function saveStoryArtifacts(jobDir, { bible, chapters }) {
  const storyDir = join(jobDir, 'story');
  if (!existsSync(storyDir)) mkdirSync(storyDir, { recursive: true });
  writeFileSync(join(storyDir, 'bible.json'), JSON.stringify(bible, null, 2));
  writeFileSync(join(storyDir, 'chapters.json'), JSON.stringify(chapters, null, 2));
}

export function loadStoryArtifacts(jobDir) {
  const biblePath = join(jobDir, 'story', 'bible.json');
  const chaptersPath = join(jobDir, 'story', 'chapters.json');
  if (!existsSync(biblePath) || !existsSync(chaptersPath)) return null;
  let bible, chapters;
  try {
    bible = JSON.parse(readFileSync(biblePath, 'utf8'));
    chapters = JSON.parse(readFileSync(chaptersPath, 'utf8'));
  } catch {
    return null;
  }
  if (bible.schemaVersion !== SCHEMA_VERSION) return null;
  if (chapters.schemaVersion !== SCHEMA_VERSION) return null;
  return { bible, chapters };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: All artifact-I/O tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/story-bible.js tests/story-bible-compress.test.js
git commit -m "feat: add story artifact I/O with schema-version guard"
```

---

## Phase 2 — Story bible LLM functions

### Task 4: Create `prompts/story-bible.md`

**Files:**
- Create: `prompts/story-bible.md`

- [ ] **Step 1: Write the prompt file**

```markdown
# Story Bible Extraction

You are a story analyst. Given chapter(s) of a Chinese novel, you extract structured facts that will later be adapted into a vertical short-drama (短剧) script.

## Per-Chapter Extraction

输入：单章节文本 + chapterIndex 编号。

输出严格 JSON，结构如下（不要输出任何额外说明文字、不要 markdown 代码框）：

```json
{
  "characters": [
    {
      "name": "string ≤ 12 chars",
      "role": "protagonist | antagonist | ally | foil | minor",
      "identity": "string ≤ 80 chars，谁",
      "motivation": "string ≤ 120 chars，为什么"
    }
  ],
  "events": [
    {
      "summary": "string ≤ 120 chars",
      "actors": ["人名"],
      "isTurningPoint": false,
      "isReveal": false
    }
  ],
  "hooks": [
    { "summary": "string ≤ 80 chars，悬念/揭示瞬间" }
  ],
  "themes": ["主题词"],
  "worldDetail": "string ≤ 200 chars 本章涉及的设定/规则/场景细节"
}
```

要求：
- 仅基于本章节出现的内容，不得编造未出现的事件或角色。
- characters 的 motivation 用本章可推断的意图，不需要全书弧光。
- isTurningPoint/isReveal 仅当本章确实出现关键转折/揭示时为 true。
- themes 取本章主导情绪/价值（最多 3 个）。

## Synthesis

输入：所有章节的 ChapterFacts 数组（按 chapterIndex 升序）。

输出严格 JSON：

```json
{
  "title": "string，best-effort 推断小说标题",
  "logline": "string ≤ 200 chars，一句话核心",
  "characters": [
    {
      "name": "string",
      "role": "protagonist | antagonist | ally | foil | minor",
      "identity": "string ≤ 80 chars",
      "motivation": "string ≤ 120 chars",
      "arc": "string ≤ 200 chars，从初到终的转变",
      "firstChapter": 1,
      "lastChapter": 42
    }
  ],
  "events": [
    {
      "eventIndex": 0,
      "summary": "string ≤ 120 chars",
      "chapterRange": [1, 1],
      "actors": ["人名"],
      "isTurningPoint": true,
      "isReveal": false
    }
  ],
  "hooks": [
    { "summary": "string ≤ 80 chars", "chapterRange": [3, 3] }
  ],
  "themes": ["主题"],
  "world": "string ≤ 400 chars，整体设定/世界观",
  "ending": "string ≤ 200 chars，原小说结局"
}
```

合并规则：
- 同名角色去重并合并：identity/motivation 取最完整或最后期版本，arc 综合首末章演变。
- firstChapter/lastChapter = 角色出现的第一/最后一章 chapterIndex。
- events 按时间顺序排列，eventIndex 从 0 起递增。
- chapterRange 取该事件横跨的章节区间。
- themes 选取出现频率最高的前 5 个；超出则丢弃。
- world 综合所有 worldDetail，输出整体设定，不堆砌细节。
- ending 必须基于最后若干章实际事件，不得虚构。

不要输出任何额外说明文字、markdown 代码框，只输出 JSON。
```

- [ ] **Step 2: Verify the file exists**

Run: `wc -l prompts/story-bible.md`
Expected: File present with ~70 lines.

- [ ] **Step 3: Commit**

```bash
git add prompts/story-bible.md
git commit -m "feat: add story-bible extraction + synthesis prompts"
```

---

### Task 5: Implement `extractChapterFacts` and `synthesizeBible`

**Files:**
- Modify: `src/story-bible.js`
- Test: `tests/story-bible-extract.test.js`

Both call into existing `callLLM` from `src/llm.js` and parse JSON. Use a fakeable LLM seam by passing a `callLLM` function as an explicit parameter (matches existing patterns in `src/snowflake.js`, where the function is imported from `llm.js` at the top).

**Note for the engineer:** The existing pattern is to import `callLLM` directly. To make tests possible without spawning real LLMs, we will accept an optional `llmFn` parameter, defaulting to imported `callLLM`. See `src/collector.js` and `src/planner.js` for similar testability patterns.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/story-bible-extract.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('extractChapterFacts', () => {
  test('parses LLM JSON response into ChapterFacts', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = {
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇' }],
      events: [{ summary: '陆衡归来', actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
      hooks: [{ summary: '戒指特写' }],
      themes: ['复仇'],
      worldDetail: '现代都市',
    };
    const fakeLlm = async () => JSON.stringify(fakeFacts);
    const result = await extractChapterFacts(
      { chapterIndex: 1, title: '归来', prose: '陆衡推开大门。' },
      { llmFn: fakeLlm }
    );
    assert.deepEqual(result.characters[0].name, '陆衡');
    assert.equal(result.events[0].summary, '陆衡归来');
    assert.equal(result.chapterIndex, 1);
  });

  test('strips markdown code fences from LLM response', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeFacts = { characters: [], events: [], hooks: [], themes: [], worldDetail: '' };
    const wrapped = '```json\n' + JSON.stringify(fakeFacts) + '\n```';
    const fakeLlm = async () => wrapped;
    const result = await extractChapterFacts(
      { chapterIndex: 1, title: '', prose: 'hi' },
      { llmFn: fakeLlm }
    );
    assert.deepEqual(result.events, []);
  });

  test('throws on invalid JSON', async () => {
    const { extractChapterFacts } = await import('../src/story-bible.js');
    const fakeLlm = async () => 'not json at all';
    await assert.rejects(
      extractChapterFacts({ chapterIndex: 1, title: '', prose: 'hi' }, { llmFn: fakeLlm }),
      /JSON|parse/i
    );
  });
});

describe('synthesizeBible', () => {
  test('passes chapter facts array and parses bible response', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const fakeBible = {
      title: 'Test',
      logline: 'logline',
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 2 }],
      events: [{ eventIndex: 0, summary: '归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
      hooks: [],
      themes: ['复仇'],
      world: '现代',
      ending: '主角胜利。',
    };
    const fakeLlm = async () => JSON.stringify(fakeBible);
    const facts = [{ chapterIndex: 1, characters: [], events: [], hooks: [], themes: [], worldDetail: '' }];
    const result = await synthesizeBible(facts, { llmFn: fakeLlm, sourceTitle: 'Test' });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.title, 'Test');
    assert.equal(result.characters[0].name, '陆衡');
  });

  test('throws when bible has zero characters', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const empty = { title: 't', logline: 'l', characters: [], events: [{ eventIndex: 0, summary: 'x', chapterRange: [1,1], actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], world: '', ending: '' };
    const fakeLlm = async () => JSON.stringify(empty);
    await assert.rejects(
      synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 't' }),
      /character/i
    );
  });

  test('throws when bible has zero events', async () => {
    const { synthesizeBible } = await import('../src/story-bible.js');
    const empty = { title: 't', logline: 'l', characters: [{ name: 'a', role: 'protagonist', identity: 'x', motivation: 'y', arc: 'z', firstChapter: 1, lastChapter: 1 }], events: [], hooks: [], themes: [], world: '', ending: '' };
    const fakeLlm = async () => JSON.stringify(empty);
    await assert.rejects(
      synthesizeBible([{ chapterIndex: 1 }], { llmFn: fakeLlm, sourceTitle: 't' }),
      /event/i
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "extractChapterFacts|synthesizeBible" | head`
Expected: FAIL with "is not a function".

- [ ] **Step 3: Implement both functions** — append to `src/story-bible.js`

```javascript
// ─── LLM extraction ───────────────────────────────────────────────────────────

import { callLLM as defaultCallLLM } from './llm.js';

const PROMPT_PATH = join(__dirname, '..', 'prompts', 'story-bible.md');

function loadPromptSection(name) {
  const tpl = readFileSync(PROMPT_PATH, 'utf8');
  // Section starts at "## <name>" and ends at next "## " or EOF.
  const re = new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
  const m = tpl.match(re);
  if (!m) throw new Error(`story-bible.md: section "${name}" not found`);
  return m[1].trim();
}

function cleanJson(raw) {
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  return s;
}

export async function extractChapterFacts(chapter, opts = {}) {
  const llmFn = opts.llmFn || defaultCallLLM;
  const role = opts.role || 'research';
  const section = loadPromptSection('Per-Chapter Extraction');
  const prompt = `${section}\n\n## 输入\n\n章节编号：${chapter.chapterIndex}\n章节标题：${chapter.title || '(无)'}\n\n${chapter.prose}`;
  const raw = await llmFn(prompt, { role });
  const cleaned = cleanJson(raw);
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) { throw new Error(`extractChapterFacts: failed to parse JSON: ${err.message}`); }
  return { ...parsed, chapterIndex: chapter.chapterIndex };
}

export async function synthesizeBible(chapterFacts, opts = {}) {
  const llmFn = opts.llmFn || defaultCallLLM;
  const role = opts.role || 'outline';
  const sourceTitle = opts.sourceTitle || '';
  const section = loadPromptSection('Synthesis');
  const prompt = `${section}\n\n## 输入\n\n源标题：${sourceTitle}\n\nChapterFacts JSON：\n${JSON.stringify(chapterFacts, null, 2)}`;
  const raw = await llmFn(prompt, { role });
  const cleaned = cleanJson(raw);
  let bible;
  try { bible = JSON.parse(cleaned); }
  catch (err) { throw new Error(`synthesizeBible: failed to parse JSON: ${err.message}`); }
  if (!Array.isArray(bible.characters) || bible.characters.length === 0) {
    throw new Error('synthesizeBible: bible has 0 characters — input may not be narrative');
  }
  if (!Array.isArray(bible.events) || bible.events.length === 0) {
    throw new Error('synthesizeBible: bible has 0 events — input may not be narrative');
  }
  return { schemaVersion: SCHEMA_VERSION, ...bible };
}
```

**Note:** the `import { callLLM as defaultCallLLM }` line must move to the top of the file with the other imports during this edit.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: All extract+synthesize tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/story-bible.js tests/story-bible-extract.test.js
git commit -m "feat: add per-chapter extraction and bible synthesis"
```

---

## Phase 3 — Bible block prompt builder

### Task 6: Add `buildBibleBlock` and `buildProseBlock` helpers

**Files:**
- Modify: `src/story-bible.js`
- Test: `tests/story-bible-prompt.test.js`

These produce the Chinese prompt section that gets appended to snowflake/outline/plan/clip prompts. Centralized here so all four call sites stay in sync.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/story-bible-prompt.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SAMPLE_BIBLE = {
  schemaVersion: 1,
  title: '战神归来',
  logline: '陆衡五年后归来复仇。',
  characters: [
    { name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 10 },
  ],
  events: [
    { eventIndex: 0, summary: '陆衡归来', chapterRange: [1, 1], actors: ['陆衡'], isTurningPoint: true, isReveal: false },
  ],
  hooks: [{ summary: '戒指特写', chapterRange: [1, 1] }],
  themes: ['复仇'],
  world: '现代都市',
  ending: '主角胜利。',
};

describe('buildBibleBlock', () => {
  test('renders heading + logline + chars + events + themes + world + ending', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const out = buildBibleBlock(SAMPLE_BIBLE, 'medium');
    assert.match(out, /## 参考小说/);
    assert.ok(out.includes('陆衡五年后归来复仇'));
    assert.ok(out.includes('陆衡'));
    assert.ok(out.includes('陆衡归来'));
    assert.ok(out.includes('复仇'));
    assert.ok(out.includes('现代都市'));
    assert.ok(out.includes('主角胜利'));
  });

  test('tight fidelity emits strict instruction', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const out = buildBibleBlock(SAMPLE_BIBLE, 'tight');
    assert.ok(out.includes('tight'));
    assert.ok(out.includes('禁止改名'));
  });

  test('loose fidelity emits inspiration-only instruction', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    const out = buildBibleBlock(SAMPLE_BIBLE, 'loose');
    assert.ok(out.includes('loose'));
    assert.ok(out.includes('灵感'));
  });

  test('throws on unknown fidelity', async () => {
    const { buildBibleBlock } = await import('../src/story-bible.js');
    assert.throws(() => buildBibleBlock(SAMPLE_BIBLE, 'extreme'), /fidelity/i);
  });
});

describe('buildProseBlock', () => {
  const CHAPTERS = [
    { chapterIndex: 1, title: '归来', charCount: 30, prose: '陆衡推开大门，浑身湿透站在前妻苏晚面前。' },
  ];

  test('renders prose block with chapter headers', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    const out = buildProseBlock(CHAPTERS, [1, 1], 'medium', 4000);
    assert.match(out, /## 原文片段/);
    assert.ok(out.includes('章节 1：归来'));
    assert.ok(out.includes('陆衡推开大门'));
    assert.ok(out.includes('不得逐字抄录'));
  });

  test('returns empty string for loose fidelity', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    const out = buildProseBlock(CHAPTERS, [1, 1], 'loose', 4000);
    assert.equal(out, '');
  });

  test('returns empty string when range has no overlap', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    const out = buildProseBlock(CHAPTERS, [99, 100], 'medium', 4000);
    assert.equal(out, '');
  });

  test('returns empty string when range is null/undefined', async () => {
    const { buildProseBlock } = await import('../src/story-bible.js');
    assert.equal(buildProseBlock(CHAPTERS, null, 'medium', 4000), '');
    assert.equal(buildProseBlock(CHAPTERS, undefined, 'medium', 4000), '');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "buildBibleBlock|buildProseBlock" | head`
Expected: FAIL with "is not a function".

- [ ] **Step 3: Implement both helpers** — append to `src/story-bible.js`

```javascript
// ─── Prompt block builders ────────────────────────────────────────────────────

const FIDELITY_NOTES = {
  tight:  '雪花/大纲/规划/片段必须严格反映上述事件顺序与人物弧光，禁止改名、换设定或重排时序。',
  medium: '可在保留核心冲突与主要人物弧光的前提下，压缩或合并相邻事件以适配短剧节奏。',
  loose:  '上述内容仅作灵感来源，可大幅改编情节与人物。',
};

export function buildBibleBlock(bible, fidelity) {
  if (!FIDELITY_NOTES[fidelity]) {
    throw new Error(`buildBibleBlock: unknown fidelity "${fidelity}", expected tight|medium|loose`);
  }
  const charLines = (bible.characters || []).map(c =>
    `- ${c.name}（${c.role}）：${c.identity} | 动机：${c.motivation}${c.arc ? ' | 弧光：' + c.arc : ''}`
  ).join('\n');
  const eventLines = (bible.events || []).map(e =>
    `${(e.eventIndex ?? '?')}. [章 ${e.chapterRange?.[0]}-${e.chapterRange?.[1]}] ${e.summary}${e.isTurningPoint ? ' ⚡转折' : ''}${e.isReveal ? ' 💡揭示' : ''}`
  ).join('\n');
  const themes = (bible.themes || []).join('、');
  return [
    '## 参考小说（必须遵循）',
    '本剧改编自下列小说。Logline、人物、事件、主题已抽取如下。',
    '',
    `【Logline】${bible.logline}`,
    '【人物】',
    charLines,
    '【事件（按时序）】',
    eventLines,
    `【主题】${themes}`,
    `【世界观】${bible.world}`,
    `【原结局】${bible.ending}`,
    '',
    `Fidelity = ${fidelity}.`,
    `- ${fidelity}: ${FIDELITY_NOTES[fidelity]}`,
  ].join('\n');
}

export function buildProseBlock(chapters, range, fidelity, budgetChars) {
  if (fidelity === 'loose') return '';
  if (!range) return '';
  const prose = selectChapterProse(chapters, range, budgetChars);
  if (!prose) return '';
  return [
    '## 原文片段（参考用语与细节）',
    '以下为本集对应的原文章节内容（节选）。请在保持短剧节奏（钩点、字数限制）的前提下，',
    '借鉴其用词、画面感、人物语气，使台词与动作更具体、更生动。',
    '不得逐字抄录超过 20 字的段落。',
    '',
    prose,
  ].join('\n');
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: All prompt-block tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/story-bible.js tests/story-bible-prompt.test.js
git commit -m "feat: add bible/prose block prompt builders"
```

---

## Phase 4 — Wire bible into existing prompt builders

### Task 7: Snowflake — accept and inject bible block

**Files:**
- Modify: `src/snowflake.js`
- Test: `tests/snowflake.test.js` (extend if exists, else inline-test in this task)

`buildSnowflakePrompt` currently takes `(materials, partIndex, priorParts, lang, genre, referenceCharacter, referenceEvent)`. We extend with two trailing options-bag parameters. To stay backwards-compatible with existing test calls, accept them via an options object on the end.

**Decision:** rather than add positional args (already 7), introduce a final `options = {}` arg with `{ bible, fidelity }`. Keep existing positional args.

- [ ] **Step 1: Read `src/snowflake.js` to find the current signature and call sites**

Run: `grep -n "buildSnowflakePrompt\|generateSnowflake" src/snowflake.js src/worker.js tests/snowflake.test.js`

- [ ] **Step 2: Write extension test** — append to `tests/snowflake.test.js` (or create a new section)

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('snowflake bible injection', () => {
  test('buildSnowflakePrompt with bible+fidelity appends bible block', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: '归来', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: ['复仇'], world: 'w', ending: 'e',
    };
    const out = buildSnowflakePrompt({}, 0, [], 'cn', '', '', '', { bible, fidelity: 'medium' });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(out.includes('Fidelity = medium'));
  });

  test('buildSnowflakePrompt without bible omits bible block', async () => {
    const { buildSnowflakePrompt } = await import('../src/snowflake.js');
    const out = buildSnowflakePrompt({}, 0, [], 'cn');
    assert.ok(!out.includes('## 参考小说'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 2 "bible injection"`
Expected: FAIL — block not present in output.

- [ ] **Step 4: Modify `src/snowflake.js`**

Add an import and extend the signature. Locate the existing `export function buildSnowflakePrompt(materials, partIndex, priorParts, lang = 'cn', genre = '', referenceCharacter = '', referenceEvent = '')`. Append `, options = {}` and append bible block at end.

```javascript
// At top with other imports:
import { buildBibleBlock } from './story-bible.js';

// Update signature:
export function buildSnowflakePrompt(materials, partIndex, priorParts, lang = 'cn', genre = '', referenceCharacter = '', referenceEvent = '', options = {}) {
  // ... existing body unchanged through to the final `return template.replace(...)` ...

  // Just before the final return, append:
  if (options.bible && options.fidelity) {
    template += '\n\n' + buildBibleBlock(options.bible, options.fidelity) + '\n';
  }

  return template.replace(/* existing replacement */);
}
```

Also update `generateSnowflake` to accept and forward `bible`/`fidelity`:

```javascript
// Find: export async function generateSnowflake(materials, options = {}) { ... }
// Inside, where it currently builds parts, the call becomes:
const prompt = buildSnowflakePrompt(materials, i, priorParts, lang, genre, referenceCharacter, referenceEvent, { bible: options.bible, fidelity: options.fidelity });
```

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: New tests pass; existing snowflake tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/snowflake.js tests/snowflake.test.js
git commit -m "feat: inject bible block into snowflake prompt when available"
```

---

### Task 8: Outline — accept bible + emit `sourceChapterRange`

**Files:**
- Modify: `src/drama-writer.js` (outline path)
- Test: `tests/drama-writer.test.js` (extend) and/or a new section

The outline prompt builder gets the bible block. The outline prompt instruction is also extended to require `sourceChapterRange` per fidelity level. Since the prompt template lives at `prompts/outline.md` and content is appended programmatically, no template-file edit is needed in this task.

- [ ] **Step 1: Locate the outline prompt builder**

Run: `grep -n "buildOutlinePrompt\|generateOutline" src/drama-writer.js | head -10`
Expected: builder function around the top half of the file.

- [ ] **Step 2: Write the failing test** — append to `tests/drama-writer.test.js`

```javascript
describe('outline bible injection', () => {
  test('buildOutlinePrompt with bible+fidelity appends bible block and chapter-range instruction', async () => {
    const { buildOutlinePrompt } = await import('../src/drama-writer.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const out = buildOutlinePrompt({}, 'cn', '', '', '', '', { bible, fidelity: 'tight', totalChapters: 3 });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('sourceChapterRange'));
    assert.ok(out.includes('tight'));
    assert.ok(out.includes('[1..3]'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 2 "outline bible injection"`
Expected: FAIL.

- [ ] **Step 4: Modify `src/drama-writer.js`**

Find `buildOutlinePrompt` and extend the signature with `options = {}` (or extend the existing options bag if one exists). Append the bible block + chapter-range instruction:

```javascript
// At top with other imports:
import { buildBibleBlock } from './story-bible.js';

// Inside buildOutlinePrompt, after existing template assembly, before return:
if (options.bible && options.fidelity) {
  template += '\n\n' + buildBibleBlock(options.bible, options.fidelity) + '\n';
  const totalChapters = options.totalChapters || 0;
  const rangeRule = options.fidelity === 'tight'
    ? `必填，且所有 episode.sourceChapterRange 合并后必须覆盖 [1..${totalChapters}] 全部章节，按顺序无遗漏。`
    : options.fidelity === 'medium'
    ? `在合理对应章节时填写 [start, end]（章节区间），否则可省略。`
    : `不填写。`;
  template += `\n\n请在每集 episode 对象中加入 \`sourceChapterRange: [start, end]\` 字段：\n- ${options.fidelity}: ${rangeRule}\n`;
}
```

Also extend `generateOutline` to forward `bible`/`fidelity`/`totalChapters` from its options:

```javascript
// In generateOutline, when calling buildOutlinePrompt, pass through:
const prompt = buildOutlinePrompt(materials, lang, style, genre, referenceCharacter, referenceEvent, {
  bible: options.bible,
  fidelity: options.fidelity,
  totalChapters: options.totalChapters,
});
```

- [ ] **Step 5: Add outline-validator test for tight fidelity coverage**

```javascript
describe('outline validator with tight fidelity', () => {
  test('parseOutline rejects tight outline missing sourceChapterRange on any episode', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [
      { episodeIndex: 0, sourceChapterRange: [1, 2] },
      { episodeIndex: 1 }, // missing
    ]};
    assert.throws(
      () => validateOutlineChapterCoverage(outline, 'tight', 4),
      /sourceChapterRange/
    );
  });

  test('parseOutline rejects tight outline whose ranges do not cover [1..N]', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [
      { episodeIndex: 0, sourceChapterRange: [1, 2] },
      { episodeIndex: 1, sourceChapterRange: [4, 5] },
    ]};
    assert.throws(
      () => validateOutlineChapterCoverage(outline, 'tight', 5),
      /coverage|gap/i
    );
  });

  test('validateOutlineChapterCoverage passes for tight outline covering [1..N]', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [
      { episodeIndex: 0, sourceChapterRange: [1, 2] },
      { episodeIndex: 1, sourceChapterRange: [3, 5] },
    ]};
    assert.doesNotThrow(() => validateOutlineChapterCoverage(outline, 'tight', 5));
  });

  test('validateOutlineChapterCoverage is a no-op for medium and loose fidelity', async () => {
    const { validateOutlineChapterCoverage } = await import('../src/drama-writer.js');
    const outline = { episodes: [{ episodeIndex: 0 }] };
    assert.doesNotThrow(() => validateOutlineChapterCoverage(outline, 'medium', 5));
    assert.doesNotThrow(() => validateOutlineChapterCoverage(outline, 'loose', 5));
  });
});
```

- [ ] **Step 6: Implement `validateOutlineChapterCoverage` in `src/drama-writer.js`**

Add a new exported function:

```javascript
/**
 * Validates that a tight-fidelity outline's sourceChapterRange fields cover [1..N].
 * No-op for medium/loose. Throws with descriptive message on failure.
 */
export function validateOutlineChapterCoverage(outline, fidelity, totalChapters) {
  if (fidelity !== 'tight') return;
  if (!outline.episodes || !outline.episodes.length) {
    throw new Error('validateOutlineChapterCoverage: outline has no episodes');
  }
  const ranges = [];
  for (const ep of outline.episodes) {
    if (!Array.isArray(ep.sourceChapterRange) || ep.sourceChapterRange.length !== 2) {
      throw new Error(`validateOutlineChapterCoverage: episode ${ep.episodeIndex ?? '?'} missing sourceChapterRange`);
    }
    ranges.push(ep.sourceChapterRange);
  }
  // Check ordering and full coverage of [1..totalChapters].
  ranges.sort((a, b) => a[0] - b[0]);
  let cursor = 1;
  for (const [s, e] of ranges) {
    if (s > cursor) throw new Error(`validateOutlineChapterCoverage: gap before chapter ${s} (cursor=${cursor})`);
    if (e + 1 > cursor) cursor = e + 1;
  }
  if (cursor - 1 < totalChapters) {
    throw new Error(`validateOutlineChapterCoverage: coverage ends at ${cursor - 1}, expected ${totalChapters}`);
  }
}
```

- [ ] **Step 7: Run tests**

Run: `npm test 2>&1 | tail -25`
Expected: All outline+validator tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: outline accepts bible+fidelity, validates sourceChapterRange coverage"
```

---

### Task 9: Plan — accept compressed bible + chapter prose

**Files:**
- Modify: `src/planner.js`
- Test: `tests/planner.test.js` (extend)

`buildPlanPrompt` already takes 5 args; we add a final `options = {}` for `{ bible, chapters, fidelity, episodeChapterRange }`. The plan prompt receives the compressed bible (only this episode's chars/events) plus the chapter prose for this episode's `sourceChapterRange`, with a 4000-char prose budget.

- [ ] **Step 1: Write the failing test** — append to `tests/planner.test.js`

```javascript
describe('planner bible injection', () => {
  test('buildPlanPrompt injects compressed bible and prose block when bible provided', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [
        { name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 5 },
        { name: '林董', role: 'antagonist', identity: 'i2', motivation: 'm2', arc: 'a2', firstChapter: 9, lastChapter: 9 },
      ],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 5, prose: 'hello' }];
    const out = buildPlanPrompt({ episodes: [] }, 'cn', '', '', '', {
      bible, chapters, fidelity: 'medium', episodeChapterRange: [1, 1],
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(!out.includes('林董'), '林董 is out of range and should be filtered');
    assert.ok(out.includes('## 原文片段'));
    assert.ok(out.includes('hello'));
  });

  test('buildPlanPrompt omits prose block on loose fidelity', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 5, prose: 'hello' }];
    const out = buildPlanPrompt({ episodes: [] }, 'cn', '', '', '', {
      bible, chapters, fidelity: 'loose', episodeChapterRange: [1, 1],
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(!out.includes('## 原文片段'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -A 2 "planner bible injection"`
Expected: FAIL.

- [ ] **Step 3: Modify `src/planner.js`**

```javascript
// At top, with other imports:
import { buildBibleBlock, buildProseBlock, compressBibleForEpisode } from './story-bible.js';

// Update signature: append options = {}
export function buildPlanPrompt(outline, lang = 'cn', genre = '', referenceCharacter = '', referenceEvent = '', options = {}) {
  // ... existing body up to but NOT yet executing the final replace ...

  if (options.bible && options.fidelity && options.episodeChapterRange) {
    const compressed = compressBibleForEpisode(options.bible, options.episodeChapterRange);
    template += '\n\n' + buildBibleBlock(compressed, options.fidelity) + '\n';
    if (options.chapters) {
      const proseBlock = buildProseBlock(options.chapters, options.episodeChapterRange, options.fidelity, 4000);
      if (proseBlock) template += '\n\n' + proseBlock + '\n';
    }
  }

  return template.replace('{{outline}}', () => JSON.stringify(outline, null, 2));
}
```

Also extend `generatePlan` to forward bible+chapters+fidelity. The plan stage runs once per outline, but the bible should be injected per-episode. Strategy: keep existing single-call generatePlan but inject the *whole-bible* in coarse form when called for the entire outline (medium fidelity is OK with this), OR wrap with per-episode calls. **Simpler choice for v1:** generatePlan calls receive bible compressed for the *first episode's range* (coarse) when running on the whole outline.

**Revised decision (engineer note):** to keep the plan stage single-call and avoid invasive surgery, just inject the *full* bible (uncompressed) when bible is provided, and inject prose for the union of all `sourceChapterRange` values up to the budget. This matches the pattern of plan being "outline-wide".

Update the prompt builder to accept this aggregate-mode:

```javascript
// REVISED inside buildPlanPrompt:
if (options.bible && options.fidelity) {
  template += '\n\n' + buildBibleBlock(options.bible, options.fidelity) + '\n';
  if (options.chapters && options.aggregateChapterRange) {
    const proseBlock = buildProseBlock(options.chapters, options.aggregateChapterRange, options.fidelity, 4000);
    if (proseBlock) template += '\n\n' + proseBlock + '\n';
  }
}
```

And update tests accordingly: pass `aggregateChapterRange` for the plan call (not `episodeChapterRange`). Update the test names and field accordingly.

**Action**: revise the test (Step 1) to use `aggregateChapterRange: [1, 1]` instead of `episodeChapterRange`, then implement as REVISED above. The compressed-bible filtering applies in the *clip stage* (Task 10), not plan stage. Plan stage gets full bible.

(Re-edit the test from Step 1 before proceeding: replace `episodeChapterRange` with `aggregateChapterRange` in both test blocks. The 林董 filtering test no longer applies for plan stage — drop that assertion; instead assert "陆衡" and "林董" both present.)

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: planner tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/planner.js tests/planner.test.js
git commit -m "feat: planner accepts bible+chapters+fidelity, injects prose block"
```

---

### Task 10: Clip — accept compressed bible per-episode + chapter prose

**Files:**
- Modify: `src/drama-writer.js` (clip generation path)
- Test: `tests/drama-writer.test.js` (extend)

The clip writer runs per-episode (or per-clip; check the actual loop structure). The bible is compressed to that episode's chapter range and the prose for that range is injected (≤ 4000 char budget). Loose fidelity skips prose.

- [ ] **Step 1: Locate the clip prompt builder**

Run: `grep -n "buildClipPrompt\|buildDramaPrompt\|generateDrama" src/drama-writer.js | head -20`

- [ ] **Step 2: Write the failing test**

```javascript
describe('clip-stage bible injection', () => {
  test('clip prompt builder injects compressed bible and per-episode prose', async () => {
    // Adapt to actual function name found in Step 1, e.g. buildClipPrompt
    const { buildClipPrompt } = await import('../src/drama-writer.js');
    const bible = {
      schemaVersion: 1, title: 't', logline: 'L',
      characters: [
        { name: '陆衡', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 },
        { name: '林董', role: 'antagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 9, lastChapter: 9 },
      ],
      events: [{ eventIndex: 0, summary: 's', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
      hooks: [], themes: [], world: 'w', ending: 'e',
    };
    const chapters = [{ chapterIndex: 1, title: '一', charCount: 5, prose: 'helloworld' }];
    const ctx = {/* whatever the existing clip-builder takes — minimal stub */};
    const out = buildClipPrompt(ctx, /* lang/genre/etc */ 'cn', '', '', '', {
      bible, chapters, fidelity: 'medium', episodeChapterRange: [1, 1],
    });
    assert.ok(out.includes('## 参考小说'));
    assert.ok(out.includes('陆衡'));
    assert.ok(!out.includes('林董'), 'compressed bible omits out-of-range chars');
    assert.ok(out.includes('## 原文片段'));
    assert.ok(out.includes('helloworld'));
  });
});
```

(Adjust signature to match actual `buildClipPrompt` — the first call argument set is whatever the existing function takes. Keep the new options as the trailing options bag.)

- [ ] **Step 3: Run to confirm fails**

Run: `npm test 2>&1 | grep -A 2 "clip-stage bible injection"`
Expected: FAIL.

- [ ] **Step 4: Modify `src/drama-writer.js`**

```javascript
// At top:
import { buildBibleBlock, buildProseBlock, compressBibleForEpisode } from './story-bible.js';

// In buildClipPrompt (or whichever per-episode/per-clip prompt builder), append options bag:
export function buildClipPrompt(/* existing args */, options = {}) {
  // ... existing body ...
  if (options.bible && options.fidelity && options.episodeChapterRange) {
    const compressed = compressBibleForEpisode(options.bible, options.episodeChapterRange);
    template += '\n\n' + buildBibleBlock(compressed, options.fidelity) + '\n';
    if (options.chapters) {
      const proseBlock = buildProseBlock(options.chapters, options.episodeChapterRange, options.fidelity, 4000);
      if (proseBlock) template += '\n\n' + proseBlock + '\n';
    }
  }
  return /* existing return */;
}
```

Also update `generateDrama` to thread `bible`/`chapters`/`fidelity` from options through to each per-episode `buildClipPrompt` call, computing `episodeChapterRange` from the outline episode's `sourceChapterRange` field (may be undefined under loose).

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: clip-stage bible-injection tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/drama-writer.js tests/drama-writer.test.js
git commit -m "feat: clip prompt accepts compressed bible + per-episode prose"
```

---

## Phase 5 — CLI flags + config + queue

### Task 11: Config defaults

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Read current `src/config.js` DEFAULTS**

Run: `grep -n "referenceCharacter\|referenceEvent" src/config.js`

- [ ] **Step 2: Add new defaults**

In `src/config.js`, in the `DEFAULTS` object, after `referenceEvent: ''`:

```javascript
  referenceCharacter: '',
  referenceEvent: '',
  referenceStory: '',
  fidelity: 'medium',
```

- [ ] **Step 3: Run existing config tests to confirm still pass**

Run: `npm test 2>&1 | grep -A 2 "config"`
Expected: existing config tests pass with no changes needed.

- [ ] **Step 4: Commit**

```bash
git add src/config.js
git commit -m "feat: add referenceStory and fidelity to default config"
```

---

### Task 12: Queue — persist new fields

**Files:**
- Modify: `src/queue.js`
- Test: `tests/queue.test.js` (if exists; otherwise extend `tests/cli-flags.test.js` end-to-end)

- [ ] **Step 1: Locate the createJob options snapshot**

Run: `grep -n "referenceCharacter\|referenceEvent" src/queue.js`

- [ ] **Step 2: Add the two new fields**

In `src/queue.js`, in the createJob options snapshot block:

```javascript
        referenceCharacter: options.referenceCharacter ?? null,
        referenceEvent: options.referenceEvent ?? null,
        referenceStory: options.referenceStory ?? null,
        fidelity: options.fidelity ?? null,
```

- [ ] **Step 3: Run existing queue/job tests**

Run: `npm test 2>&1 | grep -A 2 -E "queue|jobs"`
Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/queue.js
git commit -m "feat: persist referenceStory and fidelity on job records"
```

---

### Task 13: Scheduler — read referenceStory from config

**Files:**
- Modify: `src/scheduler.js`

- [ ] **Step 1: Find the existing referenceCharacter handling**

Run: `grep -n "referenceCharacter" src/scheduler.js`

- [ ] **Step 2: Mirror the same pattern for referenceStory**

Add the equivalent block after the existing referenceCharacter / referenceEvent blocks:

```javascript
const storyContent = config.referenceStory
  ? (() => { try { return readFileSync(config.referenceStory, 'utf8'); } catch { return ''; } })()
  : '';
```

(Or follow whatever the existing pattern is for the two equivalents — keep consistent.)

When enqueuing, pass `referenceStory: storyContent` and `fidelity: config.fidelity || 'medium'` to `createJob`.

- [ ] **Step 3: Run tests**

Run: `npm test 2>&1 | grep -E "scheduler|queue"`
Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/scheduler.js
git commit -m "feat: scheduler reads referenceStory and fidelity from config"
```

---

### Task 14: CLI flag parsing + validation in `bin/duanju-copier.js`

**Files:**
- Modify: `bin/duanju-copier.js`
- Test: `tests/cli-flags.test.js` (extend)

- [ ] **Step 1: Read current flag parsing block**

Run: `grep -n "newsUrl\|characterPath\|eventPath\|VALID_KEYS\|--news\|--character\|--event" bin/duanju-copier.js | head -30`

- [ ] **Step 2: Write the failing tests** — append to `tests/cli-flags.test.js`

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/duanju-copier.js', import.meta.url).pathname;

function runCli(args) {
  return spawnSync('node', [BIN, ...args], { encoding: 'utf8' });
}

describe('--story flag validation', () => {
  test('--story + --news rejected as mutually exclusive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md'); writeFileSync(f, 'x');
    try {
      const r = runCli(['run', '--story', f, '--news', 'http://example.com']);
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /mutually exclusive|cannot be used together/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('--story + --style rejected as mutually exclusive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md'); writeFileSync(f, 'x');
    try {
      const r = runCli(['run', '--story', f, '--style', '战神归来']);
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /mutually exclusive|cannot be used together/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('--fidelity without --story is rejected', () => {
    const r = runCli(['run', '--fidelity', 'tight']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /fidelity.*requires.*story/i);
  });

  test('invalid --fidelity value rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md'); writeFileSync(f, 'x');
    try {
      const r = runCli(['run', '--story', f, '--fidelity', 'extreme']);
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /fidelity.*tight.*medium.*loose/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('missing --story file rejected', () => {
    const r = runCli(['run', '--story', '/tmp/this-file-does-not-exist-xxxx']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /unreadable|not found|missing/i);
  });

  test('empty --story file rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md'); writeFileSync(f, '   \n  \t');
    try {
      const r = runCli(['run', '--story', f]);
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /empty/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('oversized --story file rejected (>1MB)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    const f = join(dir, 's.md'); writeFileSync(f, 'a'.repeat(1_100_000));
    try {
      const r = runCli(['run', '--story', f]);
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /size|too large|1.?MB/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 3: Run to confirm fails**

Run: `npm test 2>&1 | grep -A 2 "story flag validation"`
Expected: most rejected — flags not yet parsed; CLI may even succeed starting a run.

- [ ] **Step 4: Implement parsing + validation in `bin/duanju-copier.js`**

Find the `case 'run':` block and the existing `--news`, `--character`, `--event` handling. Add:

```javascript
} else if (args[a] === '--story' && args[a + 1]) {
  storyPath = args[a + 1]; a++;
} else if (args[a] === '--fidelity' && args[a + 1]) {
  fidelity = args[a + 1]; a++;
}
```

Then after all flags are parsed, validate:

```javascript
const MAX_STORY_BYTES = 1_000_000;
const VALID_FIDELITY = ['tight', 'medium', 'loose'];

let referenceStory = '';
const effectiveStoryPath = storyPath || config.referenceStory;
if (effectiveStoryPath) {
  if (newsUrl) {
    console.error('Error: --story and --news are mutually exclusive (cannot be used together).');
    process.exit(1);
  }
  if (style && style !== 'default') {
    console.error('Error: --story and --style are mutually exclusive (cannot be used together).');
    process.exit(1);
  }
  let st;
  try { st = statSync(effectiveStoryPath); }
  catch (err) {
    console.error(`Error: --story file unreadable or missing: ${effectiveStoryPath} (${err.message})`);
    process.exit(1);
  }
  if (st.size > MAX_STORY_BYTES) {
    console.error(`Error: --story file too large: ${st.size} bytes > 1MB limit`);
    process.exit(1);
  }
  try { referenceStory = readFileSync(effectiveStoryPath, 'utf8'); }
  catch (err) {
    console.error(`Error: --story file unreadable: ${err.message}`);
    process.exit(1);
  }
  if (!referenceStory.trim()) {
    console.error('Error: --story file is empty.');
    process.exit(1);
  }
}

if (fidelity) {
  if (!effectiveStoryPath) {
    console.error('Error: --fidelity requires --story (or referenceStory in config).');
    process.exit(1);
  }
  if (!VALID_FIDELITY.includes(fidelity)) {
    console.error(`Error: --fidelity must be one of tight, medium, loose (got "${fidelity}").`);
    process.exit(1);
  }
} else {
  fidelity = config.fidelity || 'medium';
}
```

(Add `statSync` to the existing `node:fs` import if not present.)

Pass `referenceStory` and `fidelity` to `createJob` and `runOnce`:

```javascript
const job = createJob({ lang, style, genre, newsUrl, referenceCharacter, referenceEvent, referenceStory, fidelity, episodesPerDrama, clipsPerEpisode });
await runOnce(job.id, { lang, style, genre, newsUrl, referenceCharacter, referenceEvent, referenceStory, fidelity, episodesPerDrama, clipsPerEpisode });
```

Update `VALID_KEYS` to include `'referenceStory'` and `'fidelity'`.

Update help text:

```javascript
console.log('\nRun options: duanju-copier run [count] [--lang cn] [--style 战神归来] [--genre 都市] [--news URL] [--story path.{txt,md}] [--fidelity tight|medium|loose] [--character path.md] [--event path.md] [--episodes N] [--clips-per-episode K]');
```

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -30`
Expected: all CLI flag tests pass.

- [ ] **Step 6: Commit**

```bash
git add bin/duanju-copier.js tests/cli-flags.test.js
git commit -m "feat: add --story and --fidelity CLI flags with validation"
```

---

## Phase 6 — Worker pipeline integration

### Task 15: Worker — story-extraction phase + skip research/materials

**Files:**
- Modify: `src/worker.js`
- Test: `tests/worker-story.test.js` (new) — focused unit test on the new wiring with all LLM calls mocked

- [ ] **Step 1: Read the worker entry section to plan the integration**

Run: `sed -n '60,170p' src/worker.js`

- [ ] **Step 2: Write the failing integration test**

```javascript
// tests/worker-story.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This test only exercises the story-extraction phase wiring; full pipeline
// is covered in end-to-end tests separately. We import the worker's exported
// extractIfNeeded helper that wraps splitChapters + extract + synthesize.

describe('worker story-extraction phase', () => {
  test('extractStoryArtifacts skips when artifacts exist', async () => {
    const { extractStoryArtifacts } = await import('../src/worker.js');
    const dir = mkdtempSync(join(tmpdir(), 'worker-'));
    try {
      // Pre-seed valid artifacts
      const { saveStoryArtifacts } = await import('../src/story-bible.js');
      saveStoryArtifacts(dir, {
        bible: { schemaVersion: 1, title: 't', logline: 'L', characters: [{ name: 'a', role: 'protagonist', identity: 'i', motivation: 'm', arc: 'a', firstChapter: 1, lastChapter: 1 }], events: [{ eventIndex: 0, summary: 's', chapterRange: [1,1], actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], world: 'w', ending: 'e' },
        chapters: { schemaVersion: 1, totalChars: 5, chapters: [{ chapterIndex: 1, title: '', charCount: 5, prose: 'hello' }] },
      });
      let calls = 0;
      const fakeLlm = async () => { calls++; return ''; };
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: 'whatever', llmFn: fakeLlm });
      assert.equal(calls, 0, 'no LLM calls expected when artifacts exist');
      assert.ok(result.bible);
      assert.ok(result.chapters);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('extractStoryArtifacts splits, extracts each chapter, synthesizes, persists', async () => {
    const { extractStoryArtifacts } = await import('../src/worker.js');
    const dir = mkdtempSync(join(tmpdir(), 'worker-'));
    try {
      let callIdx = 0;
      const fakeLlm = async (prompt) => {
        callIdx++;
        // Per-chapter calls return chapter facts; synthesis call returns bible.
        if (prompt.includes('Per-Chapter Extraction') || prompt.includes('章节编号')) {
          return JSON.stringify({ characters: [{ name: '陆衡', role: 'protagonist', identity: 'x', motivation: 'y' }], events: [{ summary: 'e', actors: [], isTurningPoint: false, isReveal: false }], hooks: [], themes: [], worldDetail: '' });
        }
        // Synthesis call
        return JSON.stringify({
          title: 't', logline: 'L',
          characters: [{ name: '陆衡', role: 'protagonist', identity: 'x', motivation: 'y', arc: 'a', firstChapter: 1, lastChapter: 2 }],
          events: [{ eventIndex: 0, summary: 'e', chapterRange: [1, 1], actors: [], isTurningPoint: false, isReveal: false }],
          hooks: [], themes: [], world: 'w', ending: 'end',
        });
      };
      const text = '第一章 一\n内容一。\n第二章 二\n内容二。';
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: text, llmFn: fakeLlm });
      assert.equal(result.chapters.chapters.length, 2);
      assert.equal(result.bible.characters[0].name, '陆衡');
      assert.ok(existsSync(join(dir, 'story', 'bible.json')));
      assert.ok(existsSync(join(dir, 'story', 'chapters.json')));
      assert.ok(callIdx >= 3); // 2 chapters + 1 synthesis
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 3: Run to confirm fails**

Run: `npm test 2>&1 | grep -A 2 "extractStoryArtifacts"`
Expected: FAIL with "is not a function".

- [ ] **Step 4: Implement `extractStoryArtifacts` and integrate into worker**

In `src/worker.js`:

```javascript
// At top with other imports:
import {
  splitChapters,
  extractChapterFacts,
  synthesizeBible,
  loadStoryArtifacts,
  saveStoryArtifacts,
} from './story-bible.js';

/**
 * Splits, extracts, synthesizes, and persists story artifacts.
 * If artifacts already exist with matching schemaVersion, returns them without LLM calls.
 * @param {object} opts - { jobDir, storyText, llmFn?, log? }
 * @returns {Promise<{bible, chapters}>}
 */
export async function extractStoryArtifacts({ jobDir, storyText, llmFn, log = () => {} }) {
  const existing = loadStoryArtifacts(jobDir);
  if (existing) {
    log('Story artifacts present — reusing');
    return existing;
  }
  const chapterChunks = splitChapters(storyText);
  log(`Split novel into ${chapterChunks.length} chapter chunks`);
  const facts = [];
  for (const chunk of chapterChunks) {
    const f = await extractChapterFacts(chunk, { llmFn });
    facts.push(f);
  }
  const bible = await synthesizeBible(facts, { llmFn, sourceTitle: '' });
  const totalChars = chapterChunks.reduce((sum, c) => sum + c.prose.length, 0);
  const chapters = {
    schemaVersion: 1,
    totalChars,
    chapters: chapterChunks.map(c => ({ chapterIndex: c.chapterIndex, title: c.title, charCount: c.prose.length, prose: c.prose })),
  };
  saveStoryArtifacts(jobDir, { bible, chapters });
  log(`Story bible: ${bible.characters.length} chars, ${bible.events.length} events`);
  return { bible, chapters };
}
```

Then integrate into `processJob` flow. Find the existing "Step 1: Collect materials" block and wrap:

```javascript
// New step BEFORE materials:
let bible = null;
let chapters = null;
let fidelity = options.fidelity || config.fidelity || 'medium';
const referenceStory = options.referenceStory || ''; // already snapshotted by CLI

if (referenceStory) {
  updateJob(jobId, { status: 'extracting' });
  log('Extracting story bible from reference novel...');
  wlog('story_extract_start', { storyChars: referenceStory.length });
  const jobDir = join(JOBS_DIR, jobId);
  ({ bible, chapters } = await extractStoryArtifacts({ jobDir, storyText: referenceStory, log }));
  wlog('story_extract_done', { chapters: chapters.chapters.length, charactersInBible: bible.characters.length, events: bible.events.length });
}

// Then: skip materials when bible is present
let materials = loadArtifact(jobId, 'materials.json');
if (!materials && !bible) {
  // existing collect logic
} else if (bible && !materials) {
  // synthesize a minimal materials shape from bible so downstream code that
  // expects materials still works
  materials = {
    topics: bible.themes.map(t => ({ topic: t, source: 'bible' })),
    plotHooks: bible.hooks.map(h => ({ hook: h.summary, source: 'bible' })),
    characterArchetypes: bible.characters.map(c => ({ archetype: c.role, identity: c.identity })),
    trendingTropes: [],
  };
  saveArtifact(jobId, 'materials.json', materials);
  log(`Materials synthesized from bible (skipped trend research)`);
}
```

Now thread `bible`/`fidelity`/`chapters`/`totalChapters` into the snowflake/outline/plan/clip calls. For each existing call, add the trailing options bag where relevant:

```javascript
// snowflake call:
snowflake = await generateSnowflake(materials, { lang, genre, referenceCharacter, referenceEvent, log, bible, fidelity });

// outline call:
const totalChapters = chapters ? chapters.chapters.length : 0;
baseOutline = await generateOutline(enrichedMaterials, { lang, style, genre, referenceCharacter, referenceEvent, bible, fidelity, totalChapters });
// AFTER outline returns, validate:
if (bible) {
  validateOutlineChapterCoverage(baseOutline, fidelity, totalChapters);
}

// plan call:
const aggregateChapterRange = chapters ? [1, chapters.chapters.length] : null;
basePlan = await generatePlan(baseOutline, { lang, genre, referenceCharacter, referenceEvent, bible, chapters: chapters?.chapters, fidelity, aggregateChapterRange });

// drama call (clip generation):
await generateDrama(baseOutline, basePlan, { lang, genre, referenceCharacter, referenceEvent, style, log, wlog, bible, chapters: chapters?.chapters, fidelity });
```

(Repeat for variant codepaths in worker.js — search for all `generatePlan`, `generateOutline`, `generateDrama` calls and add the new options.)

Also update `validateOutlineChapterCoverage` import:
```javascript
import { generateDrama, generateOutline, generateTailOutline, validateOutlineChapterCoverage } from './drama-writer.js';
```

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -40`
Expected: all worker-story tests pass; no regressions in existing worker/end-to-end tests.

- [ ] **Step 6: Commit**

```bash
git add src/worker.js tests/worker-story.test.js
git commit -m "feat: worker runs story-extraction phase and threads bible through pipeline"
```

---

## Phase 7 — Documentation + final verification

### Task 16: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add `--story` and `--fidelity` rows to the run-flags table**

Find the table near "支持以下旗标" and add two rows:

```markdown
| `--story <path>` | 注入参考小说（.txt/.md，≤1MB），抽取人物/事件/钩点至 story bible，下游阶段消费 |
| `--fidelity <tight\|medium\|loose>` | 配合 `--story`：tight=严格按原作；medium=保留主线压缩节奏（默认）；loose=仅作灵感 |
```

Also add a short subsection right under the existing "👤 参考人物 / 参考事件注入" explaining `--story`:

```markdown
### 📚 整本小说改编

提供一本完整小说作为参考（`--story path.txt`），系统先按章节切分并通过 LLM 抽取出 story bible（人物/事件/钩点/主题/世界观/原结局），然后将其注入到雪花、大纲、规划、片段四个阶段。`--fidelity tight|medium|loose` 控制改编紧密度：tight 完全按原作章节顺序，loose 仅取灵感。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README covers --story and --fidelity flags"
```

---

### Task 17: End-to-end happy-path test

**Files:**
- Create: `tests/story-e2e.test.js`

A single test that mocks all LLM calls and walks the pipeline from `--story` input through to a generated drama, asserting:
- bible.json + chapters.json are written
- materials.json is synthesized from bible (no real research call)
- snowflake/outline prompts contain the bible block
- final drama JSON has the same shape as a non-story run

- [ ] **Step 1: Write the e2e test**

```javascript
// tests/story-e2e.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('story pipeline e2e (mocked LLM)', () => {
  test('full happy path: extracts bible, synthesizes materials, runs through outline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      // Stand up a fake LLM that returns canned JSON for each prompt type by
      // sniffing recognizable keywords in the prompt.
      const fakeLlm = async (prompt) => {
        if (prompt.includes('Per-Chapter Extraction') || prompt.includes('章节编号')) {
          return JSON.stringify({
            characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇' }],
            events: [{ summary: '陆衡归来', actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
            hooks: [{ summary: '戒指特写' }],
            themes: ['复仇'],
            worldDetail: '现代都市',
          });
        }
        if (prompt.includes('Synthesis')) {
          return JSON.stringify({
            title: '战神归来',
            logline: '陆衡复仇归来',
            characters: [{ name: '陆衡', role: 'protagonist', identity: '战神', motivation: '复仇', arc: '隐忍→爆发', firstChapter: 1, lastChapter: 2 }],
            events: [{ eventIndex: 0, summary: '陆衡归来', chapterRange: [1, 2], actors: ['陆衡'], isTurningPoint: true, isReveal: false }],
            hooks: [{ summary: '戒指特写', chapterRange: [1, 1] }],
            themes: ['复仇'],
            world: '现代都市',
            ending: '主角胜利。',
          });
        }
        // Other phases return minimal valid JSON shapes — tests of those
        // phases live elsewhere.
        return '{}';
      };

      const { extractStoryArtifacts } = await import('../src/worker.js');
      const text = '第一章 归来\n陆衡推开大门。\n第二章 重逢\n苏晚抬起头。';
      const result = await extractStoryArtifacts({ jobDir: dir, storyText: text, llmFn: fakeLlm });

      assert.ok(existsSync(join(dir, 'story', 'bible.json')));
      assert.ok(existsSync(join(dir, 'story', 'chapters.json')));
      assert.equal(result.bible.characters[0].name, '陆衡');
      assert.equal(result.chapters.chapters.length, 2);

      // Verify a downstream prompt builder receives the bible cleanly.
      const { buildBibleBlock } = await import('../src/story-bible.js');
      const block = buildBibleBlock(result.bible, 'medium');
      assert.ok(block.includes('陆衡'));
      assert.ok(block.includes('Fidelity = medium'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass; total count = previous count + new tests added across phases.

- [ ] **Step 3: Commit**

```bash
git add tests/story-e2e.test.js
git commit -m "test: e2e smoke test for story pipeline with mocked LLM"
```

---

### Task 18: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test 2>&1 | tail -15`
Expected: 0 failures, 0 cancelled.

- [ ] **Step 2: Smoke-test the CLI manually with a short novel**

```bash
mkdir -p /tmp/dj-smoke && cat > /tmp/dj-smoke/novel.md <<'EOF'
第一章 归来
陆衡五年后归来。
第二章 重逢
苏晚抬起头。
第三章 决裂
两人对视良久。
EOF
node bin/duanju-copier.js run --story /tmp/dj-smoke/novel.md --fidelity medium --no-publish
```

Expected: job created, story-extraction phase runs, bible.json + chapters.json written under `~/.duanju-copier/jobs/<id>/story/`. (If your provider isn't configured, this will fail at the LLM call — that's fine, the CLI surface and worker phase are still validated.)

- [ ] **Step 3: Smoke-test invalid combinations**

```bash
node bin/duanju-copier.js run --story /tmp/dj-smoke/novel.md --news http://example.com  # expect: rejection
node bin/duanju-copier.js run --story /tmp/dj-smoke/novel.md --style 战神归来            # expect: rejection
node bin/duanju-copier.js run --fidelity tight                                            # expect: rejection
node bin/duanju-copier.js run --story /tmp/dj-smoke/missing.md                            # expect: rejection
```

Expected: all four exit non-zero with appropriate error messages.

- [ ] **Step 4: Final commit if any tweaks were needed**

If smoke-tests revealed issues, fix and commit. Otherwise, no commit needed for verification.

---

## Self-review

Spec coverage: every section of the spec maps to one or more tasks.

| Spec section | Task(s) |
|---|---|
| CLI surface (flags, persisted config, validation rules) | Task 11 (config), Task 14 (CLI), Task 16 (README) |
| New module `src/story-bible.js` | Tasks 1–6 |
| New prompt `prompts/story-bible.md` | Task 4 |
| Pipeline integration (skip research+materials when story present) | Task 15 |
| `bible.json` schema | Tasks 3, 5, 17 |
| `chapters.json` schema | Tasks 3, 17 |
| Outline `sourceChapterRange` augmentation + tight coverage rule | Task 8 |
| Data flow per fidelity level (snowflake/outline/plan/clip injection) | Tasks 7, 8, 9, 10 |
| Prose budget (≤4000 chars, head+tail truncation) | Task 2, used in Tasks 6, 9, 10 |
| Bible compression for plan/clip | Task 2, used in Task 10 |
| Prompt change details (bible block + prose block content) | Tasks 4, 6 |
| Anti-plagiarism prompt-level rule (≤20 char copy) | Task 6 (prose block content) |
| Error handling (chapter-regex fallback, oversized file, schema mismatch, validator failure) | Tasks 1, 3, 8, 14 |
| Resume semantics (existing artifacts skip extraction) | Task 15 |
| Compatibility with `--reference-character` / `--reference-event` (reference-pinned role) | Task 2 (compress respects reference-pinned), wiring in Task 14/15 — engineer must merge into bible.characters with role 'reference-pinned' when both flags are present |
| Testing (5 listed test files) | Tasks 1, 2, 3, 5, 6, 14, 15, 17 |

**Open follow-up for engineer:** the spec says `--story` + `--reference-character`/`--reference-event` should append the predefined character/event to the bible with role `'reference-pinned'` and stronger language. This wiring lives in worker.js right after `extractStoryArtifacts` returns. Add this in Task 15 Step 4: after the bible is returned, if `referenceCharacter` text is non-empty, push a `{name, role: 'reference-pinned', identity: <truncated>, motivation: '指定参考', arc: '指定参考', firstChapter: 1, lastChapter: <totalChapters>}` entry into `bible.characters`. Same idea for `referenceEvent` → `bible.events`. (One-line each in the worker.)

Placeholder scan: no TBD/TODO/"add appropriate error handling" — every step has concrete code or commands.

Type consistency: bible field names (`characters`, `events`, `hooks`, `themes`, `world`, `ending`, `logline`, `title`, `schemaVersion`), function names (`splitChapters`, `extractChapterFacts`, `synthesizeBible`, `compressBibleForEpisode`, `selectChapterProse`, `loadStoryArtifacts`, `saveStoryArtifacts`, `buildBibleBlock`, `buildProseBlock`, `extractStoryArtifacts`, `validateOutlineChapterCoverage`) are consistent across all tasks.
