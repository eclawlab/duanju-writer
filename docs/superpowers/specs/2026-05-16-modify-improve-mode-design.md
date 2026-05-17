# Modify & Improve Mode — Design

Date: 2026-05-16

## Goal

Add a "modify and improve" capability: download an existing novel from
usaduanju.com by its story ID, apply *small* targeted modifications driven by
user feedback, then upload the revised result back to usaduanju.com **as a new,
standalone novel** (not a variant of the original).

## Why a new command, not a `--mode` value

The existing `mode` flag (`default` / `selftell`) is a *narration-style
directive* injected into generation prompts. It rides on top of the full
generation pipeline (materials → snowflake → outline → plan → variants). The
modify flow shares none of those stages: it has no research, no snowflake, no
variant fan-out. Overloading `mode` would entangle two unrelated pipelines in
`worker.js`. Instead this is a sibling top-level command, `duanju-writer
modify`, matching how `run` is its own command. It is the app's "modify and
improve mode" exposed as a dedicated command.

## Pipeline

```
modify <storyId> --feedback "<text>"
  │
  ├─ 1. Download    GET {autostoryUrl}/api/ai/stories/{storyId}   (X-Api-Key)
  │       → normalize platform payload into the internal drama shape
  │         (the same shape uploader.buildRequest consumes)
  │
  ├─ 2. Modify      single LLM pass: (drama + feedback) → revised drama
  │       small, targeted edits; structure preserved; no full rewrite
  │
  └─ 3. Upload      POST {autostoryUrl}/api/ai/stories   (existing uploader)
          → NO variationGroupId  ⇒ platform creates a brand-new novel
          → returns new storyId
```

Synchronous, single-shot (like `run` with count=1). No queue/worker
integration: a small modification is one transform with no 30-minute LLM
stages to resume, so the queue's resume/retry machinery adds no value here.

## Components

- **`src/downloader.js`** — mirror of `uploader.js`.
  - `buildDownloadRequest(storyId, config)` → `{ url, options }`
    (GET, `X-Api-Key`, `AbortSignal.timeout`).
  - `normalizeStory(body)` → internal drama (`title, synopsis, genres, tags,
    lang, trope, genre, characters[], episodes[{ title, episodeIndex,
    isEnding, ending, scenes[{ content, choices, conclusion, ... }] }]`).
    Defensive: accepts `body.story` nested or top-level fields; tolerates
    `episodes` at either `body.episodes` or `body.story.episodes`.
  - `handleDownloadResponse(res)` → normalized drama or throws with status.
  - `download(storyId)` — fetch + parse, mirroring `upload()`.
- **`src/modifier.js`**
  - `buildModifyPrompt(drama, feedback, lang)` — loads `prompts/modify.md`,
    injects the current story JSON and the feedback.
  - `applyFeedback(drama, feedback, { llmFn?, lang? })` — one LLM call;
    parses JSON loosely; validates the result still has a title and ≥1
    episode with ≥1 scene; falls back to the original drama for any field
    the model drops so a partial response can't destroy the novel.
  - `modifyStory({ storyId, feedback, lang, title?, dryRun?, downloadFn?,
    uploadFn?, llmFn?, log? })` — orchestrator: download → applyFeedback →
    (optional title override) → upload (no variation options) → returns
    `{ originalStoryId, newStoryId, drama }`. Persists artifacts under
    `${DATA_DIR}/modifications/{storyId}-{timestamp}/`:
    `original.json`, `feedback.txt`, `modified.json`, `result.json`.
    `dryRun` skips the upload (verifiable offline / safety).
- **`prompts/modify.md`** — CN prompt instructing minimal, surgical edits that
  honor the feedback while preserving structure, character names, and the
  scene `[narrator]` / `[character:Name]` dialogue format.
- **`bin/duanju-writer.js`** — new `case 'modify'`: parse `<storyId>`,
  `--feedback`, `--feedback-file`, `--lang`, `--model`, `--title`,
  `--dry-run`; validate; call `modifyStory`; print the new storyId.

## Error handling

- Missing storyId / missing feedback → exit 1 with usage.
- Download non-2xx or empty body → throw `Download failed (status): ...`.
- LLM returns unparseable / structurally-empty JSON → throw; per-field
  fallback to the original prevents silent novel destruction on partial JSON.
- Upload errors surface via the existing `uploader` error path.
- `--feedback` and `--feedback-file` mutually exclusive; file must be non-empty.

## Testing

`node --test` (existing harness), all deps injected:

- **`tests/downloader.test.js`** — `buildDownloadRequest` URL/method/headers;
  `normalizeStory` for nested `body.story`, top-level, and `primaryGenre→genre`
  / `genres`/`tags` mapping; `handleDownloadResponse` success + error + empty.
- **`tests/modifier.test.js`** — `buildModifyPrompt` embeds story + feedback;
  `applyFeedback` applies a mocked LLM edit, preserves structure, and
  falls back per-field on partial JSON; `modifyStory` end-to-end with mocked
  `downloadFn`/`llmFn`/`uploadFn` incl. `dryRun` (no upload) and `--title`.

## Out of scope (YAGNI)

- Listing/searching platform novels (only fetch-by-id is needed).
- Multi-pass / iterative refinement; queue resume; variant fan-out.
- Diff/preview UI beyond the persisted `original.json` vs `modified.json`.
