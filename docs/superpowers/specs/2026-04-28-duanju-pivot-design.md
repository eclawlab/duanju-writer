# Duanju Pivot — Audio Novel → Short-Form Vertical Drama

**Status:** approved spec, pending implementation plan
**Date:** 2026-04-28

## 1. Goal & High-Level Architecture

Pivot duanju-writer from a Chinese/English audio-novel generator into a Chinese-only short-form vertical-drama (短剧) script writer. Each job produces one full drama series of 40–400 short clips (default 120 = 20 episodes × 6 clips), where each clip carries 10–15 seconds of structured screenplay content (`{setting, action, dialogue, hook, durationSec}`). Output is uploaded to the existing `/api/ai/stories` endpoint with a new short-drama payload shape, with the existing 3-variant ending pipeline preserved.

The 7-stage pipeline survives — research → snowflake → outline → plan → clip-writing → variant-split → upload. What changes is the *content* at each stage and the *vocabulary* used throughout the codebase.

| Stays | Changes |
|---|---|
| 7-stage pipeline | All Chinese prompts rewritten for 短剧 voice; English prompts deleted |
| Worker, scheduler, queue | `styles/` directory contents replaced with 短剧 trope library |
| `src/llm.js`, providers, roles | Outline/clip JSON schemas (linear, clip-grained, structured screenplay) |
| 3-variant ending machinery | Endings relabeled: GOOD/BITTERSWEET/SPECIAL → 爽爆/苦尽甘来/反转 |
| Resume-from-artifact behavior | AutoStory payload shape updated to drama format |
| Knowledge base + reference char/event | `--episodes N --clips-per-episode K` CLI flags added |
| Pidfile, locking, daemon-mode | Vocabulary rename: `scene → clip`, `story → drama` across all source |

**Module rename map (vocabulary):**
```
src/writer.js          → src/drama-writer.js
src/scene-types.js     → src/clip-types.js
src/story-state.js     → src/drama-state.js
src/snowflake.js       → kept (snowflake method still applies)
prompts/scenes-cn.md   → prompts/clips.md       (English version deleted)
prompts/outline-cn.md  → prompts/outline.md     (English version deleted)
prompts/plan-cn.md     → prompts/plan.md        (English version deleted)
prompts/research-cn.md → prompts/research.md    (English version deleted)
prompts/snowflake-cn.md→ prompts/snowflake.md   (English version deleted)
prompts/tail-outline.md→ kept (single file, rewritten)
```

**Implementation approach:** in-place rewrite plus vocabulary rename. The existing `src/` modules retain their structural shape; their *content* (schemas, prompts, parser logic) is rewritten, and the `scene → clip`, `story → drama` rename sweeps through identifiers, JSON keys, log strings, and tests.

## 2. Data Model

One job produces one **drama** containing N **episodes** (default 20), each containing K **clips** (default 6). Three variant copies of the drama share a `variationGroupId`, diverging in their back half.

### 2.1 Drama-level JSON (per variant)

```jsonc
{
  "title": "战神归来",
  "synopsis": "两句话钩子简介，定下复仇基调",
  "trope": "战神归来",        // matches a key in styles/ trope library
  "genre": "都市",            // 都市/古装/玄幻/重生/甜宠/复仇/校园/家庭
  "tags": ["复仇", "打脸", "扮猪吃老虎"],
  "lang": "cn",
  "characters": [
    { "name": "陆衡", "role": "protagonist", "description": "五年前被陷害失踪的特种兵" },
    { "name": "苏晚", "role": "ex-wife", "description": "被迫改嫁豪门的前妻" }
    // 3–7 characters, phonetically distinct names
  ],
  "episodes": [ /* see 2.2 */ ],
  "variationLabel": "爽爆结局"  // set by uploader per variant
}
```

### 2.2 Episode shape

```jsonc
{
  "episodeIndex": 0,
  "title": "第1集 归来",
  "isEnding": false,         // true only on final episode of each variant
  "ending": null,            // "爽爆" | "苦尽甘来" | "反转" — set when isEnding=true
  "clips": [ /* 4–10 clips, default 6 */ ]
}
```

### 2.3 Clip shape (the core unit, ~10–15s each)

```jsonc
{
  "clipIndex": 0,
  "setting": "豪门别墅 · 夜 · 暴雨",          // location · time · mood, terse
  "action": "陆衡推开大门，浑身湿透站在前妻苏晚面前。苏晚的高跟鞋掉落在地。",
  "dialogue": "[narrator]\n五年了。\n[character:陆衡]\n我回来了。\n[character:苏晚]\n你...怎么会还活着？",
  "hook": "苏晚的手机响起，来电显示：林董事长。",
  "durationSec": 12,
  "isConclusion": false,
  "conclusion": null
}
```

### 2.4 Validator constraints

- Each clip's `dialogue` ≤ 60 Chinese characters of spoken content (10–15s at typical 短剧 delivery speed of ~3–4 chars/sec).
- `action` ≤ 80 chars; `setting` ≤ 20 chars; `hook` ≤ 30 chars.
- Every non-conclusion clip MUST have a non-empty `hook`. Hook is enforced at the clip level, not the episode level.
- 3–7 named, phonetically distinct characters per drama.
- Episode count in `[10, 40]`; clips-per-episode in `[4, 10]`.
- Conclusion type renamed: `STORY_END` → `DRAMA_END`.

### 2.5 Conclusion shape (last clip of last episode of each variant)

```jsonc
{
  "isConclusion": true,
  "conclusion": {
    "title": "结局：碾压",
    "overview": "陆衡身份揭露，反派全员跪地。",
    "type": "DRAMA_END",
    "ending": "爽爆"  // 爽爆 | 苦尽甘来 | 反转
  }
}
```

### 2.6 State tracking (`drama-state.js`)

Renamed from `story-state.js`; module API and shape unchanged. Tracks `{characters, items, locations, revelations}` at clip resolution and is consumed by the planner and the consistency checker.

## 3. Pipeline & Module Changes

| # | Stage | Module | Change |
|---|---|---|---|
| 1 | Research | `collector.js` | Modify. Keep the 30-platform novel research network (still useful — many 短剧 are adapted from web novels). Add 3–5 短剧 trend sources: 抖音热门短剧, ReelShort/红果 trending lists, 微博热搜 for revenge/face-slap fuel. Prompts steer Chinese-only output. |
| 2 | Snowflake | `snowflake.js` | Modify (prompt only). Four-step structure (核心种子 → 角色 → 世界 → 情节) preserved. Prompt rewritten for 短剧 conventions: tighter conflict, archetypal characters, escalation rhythm. Module API unchanged. |
| 3 | Outline | `drama-writer.js` (renamed from `writer.js`) | Modify. Generates `episodes[].clipPlan[]` skeletons. Linear, no branching. Episode count from `--episodes` flag. Last episode `isEnding: true` with one of {爽爆, 苦尽甘来, 反转}. New JSON schema validation in `parseOutline`. |
| 4 | Plan | `planner.js` | Modify. Same module shape; now generates clip-grained state (events, revelations, character beats per clip). Re-uses `drama-state.js`. |
| 5 | Clip writing | `drama-writer.js` | Heavy modify. New `parseClip` / `buildClipPrompt` / `buildFallbackClip` replacing scene equivalents. Iterates clip-by-clip across episodes. Per-clip output validated against the §2.3 schema. Hook-presence check enforced at parse time. |
| 6 | Variant split | `worker.js` | Modify (rename + re-label). `splitIdx`/`tailCount` math unchanged. Episode-level split. Three tail outlines → three full clip-suites. Variants relabeled: `GOOD/BITTERSWEET/SPECIAL` → `爽爆/苦尽甘来/反转`. Three uploads still share `variationGroupId`. |
| 7 | Upload | `uploader.js` | Modify. Same endpoint, same auth. New payload shape (§5). |

**Cross-cutting modules:**

- `consistency.js` — clip granularity now. Hook-density check added: every non-ending clip ends on a hook beat. Existing prose-repetition checks (避免句式重复) preserved.
- `compressor.js` — compresses earlier clips into a running summary for later-clip context. Smaller compression window because clips are shorter.
- `enrichment.js` — `countWords` becomes `countChars` for CN. Target shifts from words-per-scene to chars-per-clip.
- `knowledge.js`, `vectorstore.js`, `webfetch.js`, `websearch.js` — unchanged.
- `queue.js`, `scheduler.js`, `pidfile.js`, `history.js`, `worklog.js` — unchanged.
- `styles.js` — module API unchanged. `styles/` *directory* contents replaced (§4).

**Vocabulary rename, sweep across all source/tests/prompts:**

- `scene` → `clip` (identifier names, JSON keys, log strings, prompt placeholders)
- `story` → `drama` (where it refers to the artifact). `storyId` returned from the upload response stays as-is to match the existing API contract.
- `STORY_END` → `DRAMA_END`
- File renames per §1.

## 4. Prompt Rewrites + Trope Library

### 4.1 Prompt directory (post-pivot)

```
prompts/
├── research.md        (was research-cn.md, rewritten for 短剧 inspiration)
├── snowflake.md       (was snowflake-cn.md, rewritten for 短剧 4-step planning)
├── outline.md         (was outline-cn.md, rewritten — see §2.1/§2.2 schema)
├── plan.md            (was plan-cn.md, rewritten for clip-grained planning)
├── clips.md           (was scenes-cn.md, rewritten — see §2.3 schema)
└── tail-outline.md    (rewritten for 短剧 endings: 爽爆/苦尽甘来/反转)

DELETED: research.md, snowflake.md, outline.md, plan.md, scenes.md (English versions)
```

### 4.2 Key prompt rewrites

- **`outline.md`** — Generates the linear `episodes[]` skeleton with `clipPlan[]` per episode. Constraints baked in: 10–40 episodes (default 20), 4–10 clips/episode (default 6), 3–7 phonetically distinct character names, every non-ending episode ends with a peak-tension hook, last episode `isEnding: true` with one of {爽爆, 苦尽甘来, 反转}. Heavy emphasis on 短剧 conventions: 第一集前30秒必须爆点; 每集需1-2次反转; 角色身份冲突早早抛出.
- **`clips.md`** — High-volume prompt (called once per clip). Strict 10–15s pacing rule: `dialogue` ≤ 60 CN chars, `action` ≤ 80, `setting` ≤ 20, `hook` ≤ 30. Every non-conclusion clip MUST emit a non-empty `hook` (parser rejects otherwise). Hook patterns library injected: 突然出现的反派 / 关键身份揭穿 / 意外发现的证据 / 来电响起 / 镜头特写关键道具. Drops all TTS voice tags (`|voice:alloy` etc.); keeps `[narrator]` / `[character:Name]` markers in `dialogue` for downstream voice-casting flexibility.
- **`plan.md`** — Clip-grained planner. Generates per-clip events, revelations, and character emotional beats. Tracks 伏笔 at 1–2 clip resolution.
- **`snowflake.md`** — 4-step structure unchanged conceptually. Step 4 (情节架构) constrains 三幕式 to short-drama proportions: 触发 (前 ~25%) / 升级反转 (中 ~50%) / 最终爆点+结局 (后 ~25%).

### 4.3 Trope library — `styles/` directory replacement

Same registry format (frontmatter `name`/`category` + `## Outline` + `## Clip` injection sections — `## Scene` renamed to `## Clip` per the vocab rename). Files under `styles/<category>/<trope>.md`. Initial 30 tropes:

```
styles/
├── 都市/
│   ├── 战神归来.md         龙王赘婿.md         重生归来.md
│   ├── 系统流.md           总裁追妻.md         豪门替嫁.md
│   ├── 灰姑娘逆袭.md       真假千金.md         隐藏身份.md
│   └── 一胎二宝.md
├── 复仇/
│   ├── 重生复仇.md         替身逆袭.md         校园复仇.md
│   ├── 商战复仇.md         婚后撕渣.md
├── 甜宠/
│   ├── 校园甜宠.md         闪婚甜宠.md         双向暗恋.md
│   └── 师兄妹甜宠.md
├── 古装/
│   ├── 穿越古代.md         宫斗.md             仙侠修真.md
│   ├── 王爷追妻.md         替嫁王妃.md
├── 家庭/
│   ├── 婆媳战争.md         离婚再爱.md
└── 玄幻/
    ├── 都市修仙.md         系统降临.md         超能力觉醒.md
```

Each trope file gives the LLM: signature character archetypes (e.g., 战神归来 → 落魄归来主角 + 嫌贫爱富岳父 + 隐忍前妻 + 跋扈反派), escalation pattern (前 30 秒身份揭露 / 中段 N 次打脸 / 终局碾压), preferred tropes-within-tropes (扮猪吃老虎, 装聋作哑), and signature dialogue rhythms (短促 / 多反问 / 强语气词). Selectable via `--style 战神归来`.

## 5. AutoStory Payload + Uploader

Same endpoint (`/api/ai/stories`), same auth (`X-Api-Key`), same retry/timeout/variant-grouping mechanics. The body shape changes.

### 5.1 Wire format

```jsonc
POST /api/ai/stories
{
  "format": "duanju",                   // NEW: discriminator so AutoStory routes by type
  "title": "战神归来",
  "synopsis": "两句话钩子",
  "trope": "战神归来",                  // NEW: matches a key in styles/ tropes
  "genre": "都市",                       // NEW
  "tags": ["复仇", "打脸", "扮猪吃老虎"],
  "lang": "cn",
  "characters": [                        // NEW: structured cast list
    { "name": "陆衡", "role": "protagonist", "description": "..." }
  ],
  "episodes": [
    {
      "episodeIndex": 0,
      "title": "第1集 归来",
      "isEnding": false,
      "ending": null,
      "clips": [                         // RENAMED from "scenes"
        {
          "clipIndex": 0,
          "setting": "豪门别墅 · 夜 · 暴雨",
          "action": "陆衡推开大门，浑身湿透...",
          "dialogue": "[narrator]\n五年了。\n[character:陆衡]\n我回来了。",
          "hook": "苏晚的手机响起，来电显示：林董事长。",
          "durationSec": 12,
          "isConclusion": false,
          "conclusion": null
        }
      ]
    }
  ],
  "variationGroupId": "uuid",           // unchanged: shared across all 3 variants
  "variationLabel": "爽爆结局",          // RELABELED from GOOD/BITTERSWEET/SPECIAL
  "publish": true                        // unchanged: from config.publishOnUpload
}
```

### 5.2 Fields removed from the previous shape

- `fandom` — drama doesn't borrow from existing IPs the same way; trope library covers this signal.
- `characterQuestions` — was for interactive-fiction player customization; no choices in linear 短剧.
- `playerName`, `[player]` blocks — no player avatar in 短剧.
- Scene-level `choices`, `nextSceneIndex`, `sceneType` — linear pipeline doesn't use them.
- `[character:Name|voice:alloy]` voice IDs inside `dialogue` — voice casting moves to AutoStory side.

### 5.3 Uploader code changes (`src/uploader.js`)

- Drop the `episodeChoices` strip (field no longer generated).
- Update the deep-copy to pass-through `clips` instead of `scenes`.
- Default upload timeout, AbortSignal-based cancellation, and `handleResponse` (looks for `res.body.story.id`) all unchanged.
- Variant tagging (`variationGroupId`, `variationLabel`) injection identical; only the label values change.

### 5.4 Coordination note (out of scope for this repo)

AutoStory's `/api/ai/stories` ingestion needs to accept `format: "duanju"` and the new clip schema. Treating that as a parallel server-side task; this repo just emits the new shape. If AutoStory rejects unknown `format`, it surfaces as the existing `Upload failed (...)` error — fail-loud, no silent-discard risk.

## 6. CLI Surface, Config, Breaking Changes

### 6.1 `run` command flags

| Flag | Status | Notes |
|---|---|---|
| `--lang en\|cn` | Frozen to `cn` | Internal pipeline still threads `lang`. Passing `--lang en` errors out cleanly: "English not supported; CN only." |
| `--style <trope>` | Repurposed | Values are trope keys (`战神归来`, `重生复仇`, etc.). `duanju-writer styles` lists by category. |
| `--type <genre>` | Repurposed | Internally renamed `novelType → genre`. Values: `都市\|古装\|玄幻\|重生\|甜宠\|复仇\|校园\|家庭`. |
| `--news <url>` | Kept | Still useful for "based on trending event/scandal" 短剧. |
| `--character <path>` | Kept | Reference character markdown — fan-fic-style 短剧. |
| `--event <path>` | Kept | Reference event markdown — historical/fictional event seeding. |
| `--model <provider>` | Kept | Per-job LLM provider override (unchanged). |
| `--episodes <N>` | NEW | Episodes per drama. Range 10–40. Default 20. |
| `--clips-per-episode <K>` | NEW | Clips per episode. Range 4–10. Default 6. |
| `<count>` (positional) | Kept | Number of dramas to generate sequentially. |

### 6.2 Config schema (`~/.duanju-writer/config.json`)

| Key | Status | Default |
|---|---|---|
| `autostoryUrl`, `aiApiKey`, `heartbeatInterval`, `claudePath`, `maxRetries`, `publishOnUpload` | Kept | unchanged |
| `referenceCharacter`, `referenceEvent` | Kept | path strings |
| `lang` | Kept (frozen) | `'cn'` only valid value |
| `style` | Kept (semantics changed) | trope key, e.g. `'战神归来'` |
| `novelType` | Renamed → `genre` | e.g. `'都市'` |
| `targetWordsPerScene` | Renamed → `targetCharsPerClip` | default `50` (~12s @ 4 chars/sec) |
| `episodesPerDrama` | NEW | `20` |
| `clipsPerEpisode` | NEW | `6` |

`VALID_KEYS` list in `bin/duanju-writer.js` updated. Setting an old key (`novelType`, `targetWordsPerScene`) errors out: `Unknown config key — did you mean 'genre' / 'targetCharsPerClip'?`.

The `autostoryUrl` config key is **deliberately preserved** to avoid forcing every existing user to migrate config for a cosmetic rename.

### 6.3 `styles` command (lists tropes)

```
$ duanju-writer styles
Available 短剧 tropes:

  [都市]
    战神归来 — 落魄归来主角 + 嫌贫爱富岳父 + 隐忍前妻
    龙王赘婿 — 上门女婿身份反转，扮猪吃老虎
    总裁追妻 — 强势总裁 + 离家前妻 + 双向心结
    ...

  [复仇]
    重生复仇 — 死后重生回到关键节点，步步反杀
    校园复仇 — 校园霸凌反转，从受害者到主导者
    ...

Usage: duanju-writer run --style 战神归来
   or: duanju-writer config set style 战神归来
```

### 6.4 Breaking changes (no backwards-compat)

- Job artifacts under `~/.duanju-writer/jobs/<jobId>/` now contain `outline.json` (new schema), `clips.json` (was `scenes.json`), `state.json` (drama-state shape). Existing in-flight jobs from the old pipeline will fail to resume — recommend running the migration from a clean state. Each artifact gains a top-level `"schemaVersion": 2` field; the worker's resume-from-artifact path requires `schemaVersion === 2` and otherwise refuses to resume (logs the mismatch and treats the artifact as missing, so the job regenerates from the latest valid upstream stage). Old (v1, untagged) artifacts therefore fail loudly rather than silently producing garbage.
- `episodeChoices`, `characterQuestions`, scene-level `choices`/`nextSceneIndex`/`sceneType`, `[player]` blocks, and `|voice:xxx` markers no longer generated.
- `STORY_END` conclusion type renamed to `DRAMA_END`.
- AutoStory must accept the new `format: "duanju"` payload (server-side coordination).

## 7. Testing

### 7.1 What we test (mechanical / shape)

| Area | New/updated tests | What it verifies |
|---|---|---|
| Outline parser (`parseOutline` in `drama-writer.js`) | Updated | Linear-only, 10–40 episodes, last episode `isEnding`, ending ∈ {爽爆, 苦尽甘来, 反转}, 3–7 characters, no `episodeChoices`/`characterQuestions`. |
| Clip parser (`parseClip`) | New | Required fields present, `dialogue` ≤ 60 CN chars, `action` ≤ 80, `setting` ≤ 20, `hook` ≤ 30, non-conclusion clip → non-empty `hook`, conclusion clip → `conclusion` object with `type: "DRAMA_END"`. |
| Clip prompt builder (`buildClipPrompt`) | New | Injects outline, episode title, prior-clip summary, trope `## Clip` section, character/event refs. No `[player]` blocks, no `\|voice:xxx`. |
| Fallback clip (`buildFallbackClip`) | New | Synthesizes a parser-valid clip from plan data when the LLM emits unparseable output. |
| Tail-outline parser | Updated | Three valid endings now {爽爆, 苦尽甘来, 反转}; episode-count math unchanged. |
| Trope registry (`styles.js`) | Updated | All 30 tropes load, categories enumerate, `getStyle('战神归来')` resolves, unknown trope warns once. |
| Drama-state (`drama-state.js`) | Renamed | Existing 60+ tests carry over with `story → drama` rename. |
| Uploader (`uploader.js`) | Updated | `buildRequest` emits `format: "duanju"`, `clips` not `scenes`, no `episodeChoices` strip, includes `trope`/`genre`/`characters`/`tags`, variant fields injected. |
| CLI flag validation | New | `--episodes 5` / `--episodes 50` / `--clips-per-episode 3` / `--clips-per-episode 12` rejected with explicit range. `--lang en` rejected. Old config keys (`novelType`, `targetWordsPerScene`) error with rename hint. |
| Constants | Updated | `NAME = 'duanju-writer'`, version bumped, no test for vocabulary content. |
| Char-counting (`enrichment.js`) | Updated | `countChars(cn)` replaces `countWords` for CN target validation. |

### 7.2 What we don't test

- LLM output quality, tone, "is this trope authentic" — judgment calls, not automatable.
- Actual AutoStory ingestion — out of repo scope; the upload contract test is shape-only.
- Trope content — each trope file's `## Outline` / `## Clip` text is hand-curated and reviewed visually, not asserted.

### 7.3 Manual validation gate (before merge)

1. `duanju-writer run 1 --style 战神归来 --type 都市 --episodes 20 --clips-per-episode 6` against a configured provider.
2. Inspect `~/.duanju-writer/jobs/<jobId>/`: `snowflake.json`, `outline.json`, `plan.json`, `clips.json`. Verify schema, hook density (every non-ending clip has a hook), character count caps, character roster size.
3. Verify the upload `POST` body shape matches §5.1 (intercept with a local mock or a deliberately-failing AutoStory URL and read the body from the error log).
4. Spot-check 5 random clips for whether the dialogue + action + hook actually reads as a watchable 10–15s 短剧 beat. Subjective gate — failing this means prompts need iteration, not code.

### 7.4 Test count

Current suite is 330 tests. Post-pivot estimate: 320–340 (some scene/story-named tests retired, some new clip/drama tests added, plenty of carryover). Target: full suite green before merge, with no `.skip` left behind.

## 8. Brand Text Rename (AutoStory → Duanju)

Display-name-only cleanup. Internal identifiers (`autostoryUrl` config key, `/api/ai/stories` endpoint, `X-Api-Key` header) stay untouched so existing user config and the backend contract remain stable.

| Where | Before | After |
|---|---|---|
| `README.md` headings, narrative paragraphs | "AutoStory platform" / "AutoStory API" | "Duanju platform" / "Duanju API" |
| `README.md` link label `[AutoStory](https://autostory-web.fly.dev)` | unchanged URL, label updated | `[Duanju](https://autostory-web.fly.dev)` |
| `src/setup.js` console prompts | `"AutoStory API URL"`, `"Cannot reach AutoStory API"`, etc. | `"Duanju API URL"`, etc. |
| `src/uploader.js` source comments | `"hung AutoStory API"` | `"hung Duanju API"` |
| `bin/duanju-writer.js` help/error text | any "AutoStory" mentions | "Duanju" |
| `prompts/*.md` | `"AutoStory platform — an audio novel app"` | n/a — covered by §4 full prompt rewrite |
| `src/constants.js`, `src/config.js`, `src/uploader.js` field names: `autostoryUrl`, `aiApiKey` | unchanged | unchanged |

Test impact: existing uploader/setup tests don't assert on display text, so this is no-risk for the test suite. `grep -rn "AutoStory\|autostory"` in the post-PR diff should show only kept-deliberately occurrences (config key, endpoint path).
