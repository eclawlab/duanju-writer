# Story-as-Reference Input Design

**Date:** 2026-05-05
**Status:** Approved (pending implementation plan)
**Related repos:** `duanju-writer` (this), `../duanju` (server, unaffected)

---

## Goal

Add a `--story <path>` flag (and companion `--fidelity tight|medium|loose`) to `duanju-writer run`, enabling the user to feed a complete reference novel into the pipeline. The pipeline extracts a structured story bible plus a chapter index from the novel, then adapts it into the existing duanju output format (10–40 episodes × 4–10 clips, vertical-drama clips with `setting`/`action`/`dialogue`/`hook`). The fidelity flag controls how strictly the duanju tracks the source novel's plot, characters, and event order.

This feature gives concrete meaning to the recent rename `duanju-writer` → `duanju-writer`: the tool now copies novels into duanju form.

## Non-goals

- URL-based novel input (`--story https://…`). File paths only for v1.
- EPUB/PDF/DOCX parsing. `.txt` and `.md` only for v1.
- Cross-language adaptation (e.g., English novel → Chinese duanju). Source language assumed to match output (Chinese).
- Auto-deriving `--episodes` from novel length. User-controlled count stays.
- Vectorstore/embedding-based retrieval of source prose. Deterministic chapter-range mapping only.
- Source-file content-hash tracking for resume invalidation. User clears job dir if source changes.
- Mid-pipeline LLM-summarization of overflowing chapter prose. Simple head+tail truncation only.
- Runtime anti-plagiarism check on output. Prompt-level discipline + existing char limits only.

## CLI surface

### New flags on `duanju-writer run`

| Flag | Type | Default | Notes |
|---|---|---|---|
| `--story <path>` | path to `.txt` or `.md` file | none | UTF-8; raw size ≤ 1 MB; must be a file path (URLs rejected) |
| `--fidelity <tight\|medium\|loose>` | enum | `medium` | only valid when `--story` (or persisted `referenceStory`) is in effect |

### Persisted config (`~/.duanju-writer/config.json`)

```json
{
  "referenceStory": "",
  "fidelity": "medium"
}
```

`config set` accepts both keys; `VALID_KEYS` in `bin/duanju-writer.js` is extended to include them.

### Validation rules (rejected at job-creation time in `bin/duanju-writer.js`)

- `--story` + `--news` → mutually exclusive; reject with clear message.
- `--story` + `--style` → mutually exclusive; reject with clear message.
- `--fidelity` provided without `--story` (and no persisted `referenceStory`) → reject.
- `--fidelity` value not in `{tight, medium, loose}` → reject.
- `--story` file missing / unreadable / non-UTF-8 / empty / whitespace-only / > 1 MB → reject.

### Allowed combinations

- `--story` + `--genre` → genre adds tonal coloring on top of the novel.
- `--story` + `--episodes <N>` and/or `--clips-per-episode <K>` → user override of output size; takes precedence over any episode count the bible might suggest.
- `--story` + `--reference-character <path>` → character is merged into bible's `characters` array under role `"reference-pinned"` with stronger "MUST use exactly" prompt language.
- `--story` + `--reference-event <path>` → event appended to bible's `events` with `isTurningPoint: true` and stronger prompt language.

### Help text

The `run` help line is extended:

```
duanju-writer run [count] [--lang cn] [--style 套路] [--genre 类目] [--news URL]
  [--story path.{txt,md}] [--fidelity tight|medium|loose]
  [--reference-character path.md] [--reference-event path.md]
  [--episodes N] [--clips-per-episode K]
```

## Architecture

### Pipeline integration

```
[story-extraction (NEW, only if referenceStory is set)]
  ↓
research → materials   (BOTH SKIPPED when referenceStory is set)
  ↓
snowflake → outline → plan → clips → variants → publish
```

Decision (from brainstorming Q4, choice A): only the front-end discovery stages (research, materials) are skipped. Snowflake still runs so the duanju 三幕式 (25/50/25) skeleton still shapes pacing. Outline, plan, clip stages all run, with bible (and chapter prose under tight/medium fidelity) injected into prompts.

### New module

**`src/story-bible.js`** — the only new source file. Exports:

- `splitChapters(rawText) → [{chapterIndex, title, prose}]`
  - Pure function. Tries Chinese (`第N章`, `第N节`), Western (`Chapter N` — also matches markdown-prefixed `# Chapter N`), and numeric-only headings in priority order; falls back to ~3000-char length-windowed chunks if no headings found. Logs which strategy was used.
- `extractChapterFacts(chapterChunk, llm) → ChapterFacts`
  - One LLM call per chapter using the "Per-Chapter Extraction" section of `prompts/story-bible.md`.
- `synthesizeBible(chapterFacts[], llm, sourceTitle) → Bible`
  - One LLM merge call using the "Synthesis" section. Dedupes characters by name, orders events chronologically, prunes themes to top 5, writes `logline` + `ending`.
- `compressBibleForEpisode(bible, sourceChapterRange) → string`
  - Pure function. Filters bible characters appearing in the chapter range and events whose `chapterRange` intersects. Used for plan/clip prompts to avoid injecting the full bible per call.
- `selectChapterProse(chapters, sourceChapterRange, budgetChars) → string`
  - Pure function. Concatenates prose for the range; if total exceeds `budgetChars`, returns first half + ellipsis marker (`…[省略 N 字]…`) + last half to fit budget.
- `loadStoryArtifacts(jobDir) → {bible, chapters} | null`
- `saveStoryArtifacts(jobDir, {bible, chapters}) → void`

### New prompt file

**`prompts/story-bible.md`** — two sections:

- `## Per-Chapter Extraction` — instructions to read one chunk and emit JSON: characters seen (name, identity ≤ 80 chars, motivation ≤ 120 chars, role guess), events occurring (summary ≤ 120 chars, actors, isTurningPoint, isReveal), hooks (summary ≤ 80 chars), themes touched, world detail snippets.
- `## Synthesis` — instructions to take per-chapter facts and produce one canonical `bible.json`: dedupe characters by name (merge identity/motivation/arc), order events chronologically, prune themes to ≤ 5, write `logline` ≤ 200 chars and `ending` ≤ 200 chars.

### Modified files

| File | Change |
|---|---|
| `bin/duanju-writer.js` | parse `--story` and `--fidelity`; validate per rules above; help text; extend `VALID_KEYS` |
| `src/config.js` | add defaults `referenceStory: ''` and `fidelity: 'medium'` |
| `src/queue.js` | persist `referenceStory` and `fidelity` on job records |
| `src/scheduler.js` | read `referenceStory` from config like it does for `referenceCharacter` |
| `src/worker.js` | invoke story-extraction phase before research; skip research+materials when bible exists; pipe `bible`/`chapters`/`fidelity` into snowflake/outline/plan/clip; resume support for existing artifacts |
| `src/snowflake.js` | accept `bible` and `fidelity`; render bible block in prompt |
| `src/drama-writer.js` (outline + clip generation) | accept `bible`, `chapters`, `fidelity`; render bible block in outline; require `sourceChapterRange` per fidelity rules; inject compressed bible + chapter prose in clip generation |
| `src/planner.js` | accept `bible`, `chapters`, `fidelity`; inject compressed bible + chapter prose in plan generation |
| `prompts/snowflake.md` | new conditional `## 参考小说` section |
| `prompts/outline.md` | new conditional `## 参考小说` section + `sourceChapterRange` requirement |
| `prompts/plan.md` | new conditional `## 参考小说` + optional `## 原文片段` section |
| `prompts/clips.md` | same as plan.md |

### Unaffected files

`uploader.js`, `consistency.js`, `enrichment.js`, `compressor.js`, `collector.js`, `vectorstore.js`. The output format (clips with `setting`/`action`/`dialogue`/`hook`, char limits, three-variant ending, server wire shape) is unchanged.

## Data artifacts

### `bible.json`

```json
{
  "schemaVersion": 1,
  "title": "string — best-effort, from filename or first heading",
  "logline": "string ≤ 200 chars",
  "characters": [
    {
      "name": "陆衡",
      "role": "protagonist | antagonist | ally | foil | minor | reference-pinned",
      "identity": "string ≤ 80 chars",
      "motivation": "string ≤ 120 chars",
      "arc": "string ≤ 200 chars",
      "firstChapter": 1,
      "lastChapter": 42
    }
  ],
  "events": [
    {
      "eventIndex": 0,
      "summary": "string ≤ 120 chars",
      "chapterRange": [1, 1],
      "actors": ["陆衡", "苏晚"],
      "isTurningPoint": true,
      "isReveal": false
    }
  ],
  "hooks": [
    { "summary": "string ≤ 80 chars", "chapterRange": [3, 3] }
  ],
  "themes": ["复仇", "身份认同"],
  "world": "string ≤ 400 chars",
  "ending": "string ≤ 200 chars"
}
```

### `chapters.json`

```json
{
  "schemaVersion": 1,
  "totalChars": 187432,
  "chapters": [
    { "chapterIndex": 1, "title": "归来", "charCount": 4128, "prose": "<full chapter text>" }
  ]
}
```

### Outline-stage augmentation

Each `episode` object in the outline gains an optional/required field:

```json
{
  "episodeIndex": 0,
  "summary": "...",
  "clipPlans": [...],
  "sourceChapterRange": [1, 3]
}
```

| Fidelity | `sourceChapterRange` requirement |
|---|---|
| tight | required on every episode; combined ranges must cover `[1..N]` in order with no gaps and no reordering |
| medium | optional per episode; when present must be a valid chapter range; combined ranges may collapse or skip chapters |
| loose | omitted entirely |

### Job directory layout

```
~/.duanju-writer/jobs/<jobId>/
  story/
    bible.json
    chapters.json
  materials.json     ← present only if non-story job
  snowflake.json
  outline.json
  plan.json
  drama.json
  variants/
  ...
```

## Data flow per fidelity level

| Stage | tight | medium | loose |
|---|---|---|---|
| story-extraction | runs | runs | runs |
| snowflake | bible injected; must follow events chronological order; no rename/reset of characters | bible injected; may reorder/collapse; core conflict + main arcs preserved | bible injected as inspiration only |
| outline | bible injected; must emit `sourceChapterRange` per episode covering `[1..N]` in order | bible injected; emit `sourceChapterRange` where applicable | bible injected; no chapter range |
| plan | compressed bible + chapter prose for episode's range injected | compressed bible + chapter prose injected | compressed bible only |
| clips | compressed bible + chapter prose for parent episode injected (truncated to budget) | compressed bible + chapter prose injected (truncated) | compressed bible only |

### Prose budget

- Per clip-writing call: ≤ 4000 chars of source prose injected.
- Per plan call: ≤ 4000 chars per episode.
- If `sourceChapterRange` total prose ≤ 4000, include all.
- If larger, head + tail truncation: ~2000 chars from start + `…[省略 N 字]…` marker + ~2000 chars from end.
- Loose fidelity: prose block omitted regardless of mapping.

### Bible compression

`compressBibleForEpisode(bible, sourceChapterRange)`:
- Include all characters whose `[firstChapter, lastChapter]` intersects the range, plus all `reference-pinned` characters regardless of range.
- Include all events whose `chapterRange` intersects the range.
- Always include `logline`, `themes`, `world`, `ending`.
- Drop hooks not in range.

## Prompt change details

### `prompts/snowflake.md` — new conditional section

```markdown
## 参考小说（必须遵循）
本剧改编自下列小说。Logline、人物、事件、主题已抽取如下。

【Logline】{{bible.logline}}
【人物】{{bible.characters as compact list — name + role + identity + motivation}}
【事件（按时序）】{{bible.events as numbered list — summary with chapter markers}}
【主题】{{bible.themes joined by 、}}
【世界观】{{bible.world}}
【原结局】{{bible.ending}}

Fidelity = {{fidelity}}.
- tight: 雪花四步必须完全反映上述事件顺序与人物弧光，禁止改名/换设定/重排时序。
- medium: 可压缩或合并相邻事件，但核心冲突与主要人物弧光须保留。
- loose: 上述内容仅作灵感来源，可大幅改编。
```

### `prompts/outline.md` — same bible block plus

```markdown
请在每集 episode 对象中加入 `sourceChapterRange: [start, end]` 字段：
- tight: 必填，且所有集合并后必须覆盖 [1..N] 全部章节，按顺序无遗漏。
- medium: 在合理对应章节时填写，否则可省略。
- loose: 不填写。
```

### `prompts/plan.md` and `prompts/clips.md` — bible block plus optional prose block

```markdown
## 原文片段（参考用语与细节）
以下为本集对应的原文章节内容（节选）。请在保持短剧节奏（钩点、字数限制）的前提下，
借鉴其用词、画面感、人物语气，使台词与动作更具体、更生动。
不得逐字抄录超过 20 字的段落。

【章节 {{n}}：{{title}}】
{{prose, truncated to budget}}
```

The "不得逐字抄录超过 20 字" line plus the existing per-clip char limits (`setting ≤ 20`, `dialogue ≤ 60`, `action ≤ 80`, `hook ≤ 30`) make verbatim copying structurally hard. No runtime check; prompt-level discipline only.

## Error handling

### Story-extraction phase

| Failure | Behavior |
|---|---|
| File unreadable / missing | reject at job-creation time; job never enqueued |
| File > 1 MB | reject at job-creation time |
| File empty / whitespace-only | reject at job-creation time |
| Chapter regex finds 0 chapters | fall back to ~3000-char windowed chunks; log warning; pipeline continues |
| Per-chapter extraction LLM call fails | retry up to 2× via existing `llm.js` retry; on final failure mark job `failed` |
| Synthesis returns invalid JSON | existing `repair` role kicks in (same pattern as snowflake/outline today) |
| Bible has 0 characters or 0 events | mark job `failed` with diagnostic — likely a non-narrative input |

### Downstream stages with bible

| Failure | Behavior |
|---|---|
| Outline omits `sourceChapterRange` under tight fidelity | `repair` role retries with explicit error message; mark `failed` after retries |
| Outline's `sourceChapterRange` doesn't cover `[1..N]` under tight | same as above |
| Outline references a chapter index that doesn't exist | same as above |
| Plan/clip prose injection: chapter index missing or out of range | skip prose block, log warning, continue (graceful degrade — bible alone is still useful) |

## Resume semantics

- `bible.json` + `chapters.json` exist with `schemaVersion === 1` → skip story-extraction, reuse artifacts.
- Schema mismatch → re-extract from scratch (same policy as snowflake/outline today).
- Source file changed since last run → not detected; user is responsible for clearing job dir or running fresh.

## Testing

| Test file | Coverage |
|---|---|
| `tests/story-bible-split.test.js` | `splitChapters` — Chinese headings, English headings, mixed, no headings (length fallback), edge cases (1 chapter, empty input) |
| `tests/story-bible-compress.test.js` | `compressBibleForEpisode` — character filtering, event intersection, output stays under length budget; `selectChapterProse` truncation behavior |
| `tests/story-bible-prompt.test.js` | Prompt builders for snowflake/outline/plan/clip — bible block renders correctly per fidelity, prose block omitted on loose, char-budget truncation |
| `tests/cli-flags.test.js` (extend) | `--story` + `--news` rejected; `--story` + `--style` rejected; `--fidelity` requires `--story`; invalid fidelity rejected; missing/oversized/empty file rejected |
| `tests/worker.test.js` (new or extend) | story-extraction phase: skipped when no `--story`; runs when present; resume from existing `bible.json`; research+materials skipped when story is present |

LLM-call tests use mocked clients per the existing patterns in `tests/snowflake.test.js`, `tests/drama-writer.test.js`, `tests/planner.test.js`.

## Future enhancements (out of scope for v1)

- URL-based input (`--story https://…`)
- EPUB/PDF parsing
- Embedding-based source-prose retrieval (RAG via `vectorstore.js`)
- Mid-pipeline LLM summarization of overflowing chapters (instead of head+tail truncation)
- Source-file content-hash for automatic resume invalidation
- Auto-deriving `--episodes` from novel length
- Translation pipeline (English novel → Chinese duanju)
- Runtime verbatim-copy detection
