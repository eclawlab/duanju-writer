# Canonical Scene Schema — Writer/Server Contract Reconciliation

**Date:** 2026-04-28
**Status:** Spec — pending implementation plan
**Related repos:** `duanju-writer` (this), `../duanju` (server)

## Problem

The writer posts to `POST /api/ai/stories` on the duanju server, but the two repos disagree on the request shape:

- The writer sends `episodes[i].clips[]` with per-beat fields (`setting`, `action`, `dialogue`, `hook`, `durationSec`, `isConclusion`, `conclusion`-as-string).
- The server reads `episodes[i].scenes[]` with `{ content, choices?, conclusion? }`. It dereferences `ep.scenes.length` (`server/routes/ai.ts:177`), so a `clips`-shaped payload throws inside the handler.

Even if `clips` were renamed to `scenes`, the inner shapes are incompatible: the server's `content` is a single block-formatted string and its `conclusion` is a structured object with a fixed enum, not the writer's free-text string.

Writer-only fields silently dropped today (no validation, no storage, no error): `format`, `trope`, `genre` (singular), `lang`, `characters`, `episode.isEnding`, `episode.ending`, body-level `idempotencyKey`. The server's `Idempotency-Key` header is also unused — no dedup logic exists.

## Goal

Make uploads succeed against the existing `duanju` server **without changing the server**. The writer's stored artifacts and wire payload both adopt the server-canonical scene shape. LLM prompts and per-beat quality controls (CN-char limits, hook-density check, conclusion validation) stay as they are.

## Non-Goals

- Rewriting prompts to emit scene `content` directly (parked as a future "B-pivot" spec).
- Server-side idempotency.
- Persisting narrative `characters[]` on the server.
- Extending the server's `ending` enum with native 短剧 values.

## Architecture

One translation point lives in `parseClip`. After parseClip returns, the writer pipeline only sees scene-shaped objects. The four beats survive on a non-enumerable `_beats` ride-along that the compressor and consistency check consult; nothing else reads them.

```
LLM → raw JSON (4 beats: setting/action/dialogue/hook)
    → parseClip:
        1. validate beats           (CN-char limits, hook required, conclusion shape)
        2. compose `content`        (4 beats → block-format string)
        3. translate `conclusion`   (DRAMA_END→STORY_END; 中文 ending → enum)
        4. return { content, choices: [], conclusion?, _beats }
    → compressor / consistency read _beats
    → worker stores story.json (scene-shaped on disk)
    → uploader posts (scene-shaped wire payload — no translation needed)
```

### Wire format

```json
{
  "title": "...",
  "synopsis": "...",
  "genres": ["都市", "复仇"],
  "tags": ["战神归来", "打脸"],
  "publish": true,
  "variationGroupId": "grp-<jobId>",
  "variationLabel": "爽爆",
  "episodes": [
    {
      "title": "第1集 归来",
      "episodeIndex": 0,
      "scenes": [
        {
          "content": "[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门，肩头血迹未干\n\n[character:陆衡]\n三年了……该回去了\n\n[narrator]\n身后传来摩托引擎声",
          "choices": []
        },
        {
          "content": "[narrator]\n灯熄\n\n[character:陆衡]\n这局，我赢",
          "choices": [],
          "conclusion": {
            "title": "结局：碾压",
            "overview": "陆衡身份揭露，反派全员跪地",
            "type": "STORY_END",
            "ending": "GOOD"
          }
        }
      ]
    }
  ]
}
```

Headers: `Content-Type: application/json`, `X-Api-Key: <key>`, `Idempotency-Key: <jobId>.<variantKey>`.

### Content composition rule (`composeScene(beats)`)

Concatenate the four beats as block-format text, one beat per `[narrator]` block, with blank lines between blocks:

1. `setting` — emit only if non-empty, wrapped in a `[narrator]` block.
2. `action` — always present (validation requires it), `[narrator]` block.
3. `dialogue` — already block-formatted by the LLM (`[narrator]` / `[character:Name]`); insert verbatim.
4. `hook` — emit only if non-empty (omitted on conclusion clips by validation), `[narrator]` block.

Each block is separated from the next by `\n\n`. Result is a single non-empty string.

### Ending mapping

```js
const ENDING_LABEL_TO_ENUM = {
  '爽爆':   'GOOD',     // unambiguous win
  '苦尽甘来': 'NEUTRAL',  // bittersweet-but-positive
  '反转':   'SPECIAL',  // final twist outside the standard taxonomy
};
```

Mapping is applied **after** the existing label validation in parseClip — an unknown label can never reach the table. The 中文 label is also preserved verbatim in `stories.variation_label` (already wired up in worker.js), so any consumer that needs the precise label has it.

### Field disposition (writer-side fields the server has no column for)

| Field | Disposition | Rationale |
|---|---|---|
| `format` | drop from wire | Server doesn't branch on it |
| `lang` | drop from wire | No server column; writer is hardcoded to `cn` |
| `genre` (singular) | prepend to `genres[]` | Server's `genres` is a generic string array |
| `trope` | push into `tags[]` | Same logic — `tags` is a generic string array |
| `characters[]` | drop from wire (kept in writer artifacts) | No good server home; `characterQuestions` is the wrong shape |
| `episode.isEnding` | drop from wire | Server has no column; presence of a `STORY_END` conclusion serves the structural role |
| `episode.ending` | drop from wire | Server has no column; `variation_label` carries the human-readable label |
| `idempotencyKey` (body) | drop | Non-standard noise; header is the standard mechanism |
| `Idempotency-Key` (header) | keep | Standard mechanism; ready when server adds dedup |

## Components

### File-by-file deltas

| File | Change |
|---|---|
| `src/drama-writer.js` `parseClip` | After existing validation, call `composeScene(beats)` to build `content`, translate `conclusion` (`DRAMA_END`→`STORY_END`; ending label → enum), return `{ content, choices: [], conclusion: <object\|null>, _beats: { setting, action, dialogue, hook, durationSec, clipIndex, isConclusion } }`. `_beats` is set with `Object.defineProperty(…, { enumerable: false })`. |
| `src/drama-writer.js` `composeScene` | New private helper. Pure function from beats to a non-empty content string per the composition rule. |
| `src/drama-writer.js` `buildFallbackClip` | Synthesize beats, then run them through `composeScene` and the same conclusion translator so fallback output is the same shape as parsed output. |
| `src/drama-writer.js` `generateClip` retry loop | No code change — still calls `parseClip`, which now returns scene-shaped. |
| `src/drama-writer.js` ending mapping | Add `ENDING_LABEL_TO_ENUM` constant (see above). |
| `src/compressor.js` | Switch from `clip.setting/action/dialogue/hook` to `clip._beats.setting/...`. Logic identical, access path changes. |
| `src/consistency.js` `checkHookDensity` | Read `clip._beats.hook` instead of `clip.hook`. Same logic. |
| `src/uploader.js` `buildRequest` | Strip the lossy translator. Wire payload becomes a near-verbatim subset of the in-memory drama: `{ title, synopsis, genres: [drama.genre, ...drama.genres].filter(Boolean), tags: [drama.trope, ...drama.tags].filter(Boolean), publish, variationGroupId, variationLabel, episodes: drama.episodes.map(ep => ({ title: ep.title, episodeIndex: ep.episodeIndex, scenes: ep.scenes })) }`. Drop `format`, `lang`, `characters`, `episode.isEnding/ending`, body-level `idempotencyKey`. Header `Idempotency-Key` retained. |
| `src/worker.js` clip/word counters | `ep.clips` → `ep.scenes`. Word counting on `sc.content` (already referenced at line 364 — that was a half-finished migration; this completes it). |
| `src/worker.js` artifact filenames | Unchanged. Internal shape changes — see migration. |
| `src/planner.js` / `src/drama-state.js` | Unchanged. The clip→scene composition happens *after* generation, on validated LLM output. |
| `prompts/*.md` | Unchanged. LLM still produces 4-beat clips. |
| `src/drama-writer.js` `parseOutline` / `parseTailOutline` | Unchanged. Episode-level `isEnding`/`ending` stay in the outline (the planner needs them to target endings); they just don't reach the wire. |

## Validation & Error Handling

**Preserved unchanged.** Per-beat CN-char limits (setting≤20, action≤80, dialogue≤60, hook≤30); hook-required-on-non-conclusion clips; conclusion-shape (must be object, type must be `DRAMA_END`); ending label must be one of 爽爆/苦尽甘来/反转. All run on beats *before* composition.

**New.**
- After `composeScene`, assert `content` is a non-empty string. Throw `clip composition produced empty content` on failure (defensive guard against beat composition silently producing empty output).
- Ending-label-to-enum mapping runs *after* validation, so an invalid label can never produce `undefined`.

**Failure modes.**
- Server returns 400 because the writer sent a malformed scene → existing `handleResponse` raises `Upload failed (400): <error>`. Unchanged.
- Server returns 500 from a transaction failure → existing error path. Unchanged.
- Duplicate-storyId-on-retry detection in `worker.js:397–403` → unchanged. Server still doesn't dedupe; writer still logs loudly.

## Testing

| Test | What it covers |
|---|---|
| `parseClip` unit: valid 4-beat input → returns scene with composed content, empty choices, conclusion null | Happy path, non-conclusion clip |
| `parseClip` unit: conclusion clip with each of 爽爆/苦尽甘来/反转 → `conclusion.ending` is `GOOD`/`NEUTRAL`/`SPECIAL`, `type` is `STORY_END` | Ending mapping table |
| `parseClip` unit: clip with empty `setting` → composition skips the setting block, content still valid | Optional-block handling |
| `parseClip` unit: conclusion clip with empty `hook` → composition skips the hook block, content still valid | Optional-block handling |
| `parseClip` unit: existing per-beat CN-char limit failures still throw before composition | Validation order |
| `parseClip` unit: returned object's `_beats` is non-enumerable (`JSON.stringify(scene)` does not contain `"setting"`) | Ride-along invisibility |
| `buildFallbackClip` unit: output is scene-shaped and round-trips through `JSON.stringify` without `_beats` leaking | Fallback parity |
| `composeScene` unit: covers empty/non-empty setting, empty/non-empty hook, conclusion-clip, dialogue with `[character:Name]` block | Composition rule directly |
| `compressor` unit: input is scene-shaped clips with `_beats` → output digest unchanged from previous beat-shaped input | No regression in compression |
| `consistency.checkHookDensity` unit: same as above | No regression in hook check |
| `uploader.buildRequest` unit: `genre` prepended to `genres`, `trope` pushed to `tags`, no `format`/`lang`/`characters`/`episode.isEnding`/`episode.ending` keys, no body `idempotencyKey`, header `Idempotency-Key` present | Wire shape |
| Uploader integration: stub fetch with the server's actual 400 on `episodes[].clips`, then run new payload against an in-process boot of `../duanju`'s `aiRoutes` (or the closest equivalent the server's test harness exposes) and assert 201 | End-to-end with the real server route |
| Worker counter test: `ep.scenes` traversal correct for clip/word totals | Worker rename |

The end-to-end test is load-bearing. Implementation will discover what the `../duanju` test harness already exposes (in-process Fastify boot vs. HTTP fetch against a locally-booted instance) and pick the lighter path.

## Migration

- Bump `SCHEMA_VERSION` in `src/worker.js` by one. The existing loader refuses to load artifacts with a stale version (`worker.js:56–57`), so in-flight jobs regenerate from scratch on next worker tick. Acceptable: the writer hasn't shipped to users; jobs are local and cheap to re-run.
- No DB migration on the server. No server changes.
- New `story.vN.json` artifacts contain `episodes[].scenes[]` instead of `episodes[].clips[]`. Old artifacts fail the schemaVersion check and regenerate.

## Out of Scope (parked for future specs)

- **B-pivot** — LLM directly emits scene `content`. Re-evaluate after a few real uploads land and we see whether per-beat discipline is doing the work we think it is.
- **Server-side `Idempotency-Key` honoring** — separate spec on the `duanju` server. The writer's duplicate-detection log line stands in until then.
- **Persisting narrative `characters[]` server-side** — would require a new `story_characters` table or extending an existing one. Defer until a UI consumer asks.
- **Extending the server's `ending` enum** with native `SHUANG_BAO`/`GAN_CHU`/`FAN_ZHUAN` values. The current `variation_label` carries the precise label; the enum is good enough for filter/aggregation use.
