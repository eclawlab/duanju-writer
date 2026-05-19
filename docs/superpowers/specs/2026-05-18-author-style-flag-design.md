# `--author-style` flag — design

Date: 2026-05-18
Status: Approved (pending spec review)

## Summary

Restore the 15 Chinese-author writing-style definitions that were deleted in
commit `6ca6906` ("replace literary styles with 30 短剧 tropes") and expose them
through a **new, independent** `--author-style` CLI flag. The flag controls
**prose voice only** and is fully orthogonal to the existing `--style` (trope),
`--story` (reference novel), `--news`, and `--mode` flags. The trope system
(`styles/`, `src/styles.js`) is left completely untouched.

## Motivation

`--style` selects a 短剧 trope (plot formula + hook cadence). `--story` supplies
a reference novel (plot source). Neither controls the *prose voice* — the
author's diction, rhythm, and sentence texture. The project previously had this
capability via 15 author files under `styles/chinese-literary|scifi|webnovel/`,
removed during the duanju pivot. This design reinstates it as a separate axis so
voice can be combined with any trope or adaptation rather than competing for the
same slot.

## Scope

In scope:

- Restore the 15 author files verbatim into a new `author-styles/` tree.
- New loader module `src/author-styles.js`.
- `--author-style <key>` CLI flag, config key, queue/scheduler persistence,
  worker threading.
- Injection into clip-prose generation only.
- `duanju-writer author-styles` listing subcommand.
- Tests.

Out of scope (YAGNI):

- Auto-selection of an author voice (no `pickAuthorStyle`). Default is **off**;
  author voice is never silently imposed.
- Injection into snowflake / outline / plan stages. Clip-prose only.
- Editing or re-coupling the trope system.
- Per-character or per-episode voice overrides.

## The 15 author files

Restored from `6ca6906~1`, filenames unchanged, into `author-styles/`:

| Category (directory)        | Files (keys)                                                                 |
|-----------------------------|------------------------------------------------------------------------------|
| `author-styles/chinese-literary/`  | `jinyong`, `laoshe`, `luxun`, `moyan`, `sanmao`, `shencongwen`, `wangxiaobo`, `yuhua`, `zhangailing` |
| `author-styles/chinese-scifi/`     | `liucixin`                                                                   |
| `author-styles/chinese-webnovel/`  | `ergen`, `maoni`, `priest`, `tangjiasanshao`, `tiancantudou`                 |

Each file retains its original frontmatter (`name`, `category`) and its
`## Outline` and `## Scene` sections. Only `## Scene` is consumed by the loader.
`## Outline` is preserved verbatim for possible future use but is **ignored**.

## Architecture

### `src/author-styles.js` (new)

Structurally mirrors `src/styles.js`:

- `AUTHOR_STYLES_DIR = join(__dirname, '..', 'author-styles')`
- `loadAuthorStylesFromDisk()` — walks category subdirectories, parses each
  `.md`: frontmatter `name`/`category`, body `## Scene` block → `.scene`
  (string; empty string if the section is absent, with a `console.warn`).
- Module-level `_cache`; `getAuthorStyles()` populates it lazily;
  `clearAuthorStyleCache()` for tests.
- `getAuthorStyle(key)` — lowercased lookup; throws
  `Unknown author style: "<key>"\nAvailable author styles:\n<list>` on miss
  (mirrors `getStyle`).
- `getAuthorStyleSafe(key)` — returns `null` and `console.warn`s on miss
  (mirrors `getStyleSafe`); used in the worker path for graceful degradation.
- `listAuthorStyles()` — `[{ key, name, category }]` (mirrors `listStyles`).

### Pipeline injection — clip prose only

In the clip-generation loop in `src/drama-writer.js` (~line 1216, where
`tropeStyle`/`tropeSection` are resolved today), add:

```js
const authorVoice = getAuthorStyleSafe(authorStyle)?.scene || '';
```

`authorVoice` is passed into the existing `generateClip({ ... })` ctx object.
`buildClipPrompt(ctx)` destructures `authorVoice = ''` and, when non-empty,
**appends** an author-voice section to the rendered prompt using the same
append-after-render pattern already used for the bible block and the selftell
directive. No placeholder is added to `prompts/clips.md` and that template is
not edited.

Appended block (rendered only when `authorVoice` is non-empty):

```
## 文风 / Author Voice

Write the prose in the following author's voice. This governs diction,
rhythm, imagery, and sentence texture only — it does NOT change the plot,
trope structure, characters, or events.

<authorVoice>
```

Empty `authorVoice` → nothing appended; clip output is byte-identical to
current behavior. This guarantees the default (no `--author-style`) path is
unchanged.

### Data flow / plumbing

A single new parameter `authorStyle` (string; `''` = off) threads through the
same path `mode` uses today:

1. **`bin/duanju-writer.js`**
   - Parse `--author-style <key>` in the `run` arg loop (alongside `--mode`).
   - Before creating any jobs, validate: if `authorStyle` is set and not in
     `listAuthorStyles()` keys, print the available list and `process.exit(1)`
     (mirrors the existing trope `--style` validation block).
   - Pass `authorStyle` into `createJob(...)` and `runOnce(...)` option objects.
   - Add `'authorStyle'` to the `config` command `VALID_KEYS` array.
   - Update `run` usage/help strings and add `--author-style` to the documented
     options.
2. **`src/config.js`** — add `authorStyle: ''` to `DEFAULTS`.
3. **`src/queue.js`** — persist `authorStyle: options.authorStyle ?? null` on
   the job record (alongside `mode`).
4. **`src/scheduler.js`** — `authorStyle: config.authorStyle || undefined` in
   the scheduler-created job options (alongside `mode`).
5. **`src/worker.js`**
   - Resolve `const authorStyle = options.authorStyle || config.authorStyle || ''`
     (alongside the existing `mode` resolution, ~line 265).
   - Thread `authorStyle` into the `generateDrama(materials, { ... })` option
     object — the same call sites that already pass `style`/`mode`
     (worker.js ~434 and ~597).
   - Include `authorStyle` in the persisted job-record options so daemon-mode
     retries reproduce it (alongside `style`/`mode`, ~line 870).
   - Add an `Author voice:   <authorStyle or '(none)'>` line to the run summary
     block (near the `Trope:` line, ~line 742).

`generateDrama` (the exported function containing the clip loop, ~line 945)
gains an `authorStyle` option, defaulting to `''`, used only to compute
`authorVoice` per clip. It is invoked twice from the worker (front story and
tail variants); both call sites pass `authorStyle` so front and tail prose
share one voice.

### New subcommand: `duanju-writer author-styles`

Lists the 15 entries (`key`, `name`, `category`), mirroring the existing
`styles` subcommand's formatting and the `case` dispatch in
`bin/duanju-writer.js`. Update the top-level usage string to mention it.

## Orthogonality

No mutual-exclusion checks are added. `--author-style` is accepted with any
combination of `--style`, `--story`, `--news`, and `--mode`. Its only effect is
appending the voice block to clip prompts. This is the explicit design choice
that justifies a separate flag rather than reviving the shared `styles/` slot.

## Error handling

| Situation                                   | Behavior                                                                 |
|---------------------------------------------|--------------------------------------------------------------------------|
| Invalid `--author-style` key at CLI         | Print available list, `process.exit(1)` (hard fail, like trope `--style`).|
| Invalid key reaching worker (stale config)  | `getAuthorStyleSafe` returns `null`, `console.warn`s, clip generated with no voice (graceful degrade). |
| Author file missing `## Scene` section      | Loader sets `.scene = ''`, logs a `console.warn`; that author produces no voice injection. |
| `author-styles/` directory missing entirely | Loader returns `{}` (mirrors `styles.js` `readdirSync` failure handling); any non-empty `--author-style` then fails CLI validation. |

## Testing

| Test file                              | Coverage                                                                                   |
|----------------------------------------|--------------------------------------------------------------------------------------------|
| `tests/author-styles.test.js` (new)    | All 15 files load; `## Scene` parsed into `.scene`; `getAuthorStyle` throws-with-list on unknown key; `getAuthorStyleSafe` warns + returns `null`; `clearAuthorStyleCache` resets cache. |
| `tests/cli-flags.test.js` (extend)     | `--author-style moyan` accepted; invalid key rejected with available list; `--author-style` + `--style` accepted together; `--author-style` + `--story` accepted together (orthogonality regression). |
| `tests/drama-writer.test.js` (extend)  | `buildClipPrompt` includes the `## 文风 / Author Voice` block (and the supplied voice text) when `authorVoice` is set; omits it entirely when `authorVoice` is `''`. |

LLM-call tests use mocked clients per existing patterns
(`tests/drama-writer.test.js`).

## Files touched

| File                          | Change                                                                 |
|-------------------------------|------------------------------------------------------------------------|
| `author-styles/**` (15 files) | New — restored verbatim from `6ca6906~1`.                              |
| `src/author-styles.js`        | New — loader/registry, mirrors `src/styles.js`.                        |
| `src/drama-writer.js`         | Resolve `authorVoice` in clip loop; render block in `buildClipPrompt`; `generateDrama` gains `authorStyle` option. |
| `src/worker.js`               | Resolve + thread `authorStyle`; job-record options; run summary line.  |
| `src/config.js`               | `authorStyle: ''` default.                                            |
| `src/queue.js`                | Persist `authorStyle` on job record.                                  |
| `src/scheduler.js`            | Pass `authorStyle` from config.                                       |
| `bin/duanju-writer.js`        | Parse/validate `--author-style`; `VALID_KEYS`; `author-styles` subcommand; help/usage text. |
| `tests/author-styles.test.js` | New.                                                                  |
| `tests/cli-flags.test.js`     | Extend.                                                               |
| `tests/drama-writer.test.js`  | Extend.                                                               |
| `README.md`                   | Document `--author-style` and the `author-styles` subcommand.         |

## Future enhancements (out of scope)

- Optional auto-selection (`pickAuthorStyle`) analogous to `pickStyle`.
- Author voice applied to outline/plan for end-to-end tonal consistency.
- User-supplied custom voice file (`--author-style path.md`).
