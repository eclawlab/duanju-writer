# Narrative Intelligence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 narrative intelligence features to the story generation pipeline: planning agent, dynamic history compression, entity state tracking, revelation scheduling, prose consistency checking, and character-scoped context.

**Architecture:** Four new modules (`planner.js`, `story-state.js`, `compressor.js`, `consistency.js`) slot into the existing `writer.js` pipeline between outline and scene generation. Two new prompt templates (`plan.md`, `plan-cn.md`) drive the planning agent. The scene prompt templates are extended with optional sections for state/history/revelations. All new state is JSON-serializable for job resumption.

**Tech Stack:** Node.js 20+, Claude Code CLI (via existing `callClaude`), no new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/planner.js` | Create | Planning agent: takes outline, produces enriched plan with events, threads, revelations |
| `src/story-state.js` | Create | Entity state tracker: characters, items, locations, knowledge tracking, character-scoped context |
| `src/compressor.js` | Create | History compression: summarizes scenes into hierarchical context |
| `src/consistency.js` | Create | Prose consistency: detects repetition, requests rewrites |
| `prompts/plan.md` | Create | English planning agent prompt template |
| `prompts/plan-cn.md` | Create | Chinese planning agent prompt template |
| `src/writer.js` | Modify | Integrate all 4 modules into generateStory pipeline |
| `src/worker.js` | Modify | Save new artifacts (plan.json, state.json) |
| `tests/planner.test.js` | Create | Tests for planner |
| `tests/story-state.test.js` | Create | Tests for state tracker |
| `tests/compressor.test.js` | Create | Tests for compressor |
| `tests/consistency.test.js` | Create | Tests for consistency checker |

---

### Task 1: Story State Tracker (`src/story-state.js`)

The foundation — other modules depend on this for entity tracking, character scoping, and revelation scheduling.

**Files:**
- Create: `src/story-state.js`
- Create: `tests/story-state.test.js`

- [ ] **Step 1: Write failing tests for StoryState**

```js
// tests/story-state.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('story-state', () => {
  test('create initializes empty state', async () => {
    const { createState } = await import('../src/story-state.js');
    const state = createState();
    assert.deepEqual(state.characters, {});
    assert.deepEqual(state.items, {});
    assert.deepEqual(state.locations, {});
    assert.deepEqual(state.revelations, []);
  });

  test('addCharacter tracks a character', async () => {
    const { createState, addCharacter } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: ['knows about the map'] });
    assert.equal(state.characters['Alice'].status, 'alive');
    assert.equal(state.characters['Alice'].location, 'forest');
    assert.deepEqual(state.characters['Alice'].knowledge, ['knows about the map']);
  });

  test('updateCharacter merges fields', async () => {
    const { createState, addCharacter, updateCharacter } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [] });
    updateCharacter(state, 'Alice', { location: 'castle', emotional: 'afraid' });
    assert.equal(state.characters['Alice'].location, 'castle');
    assert.equal(state.characters['Alice'].emotional, 'afraid');
    assert.equal(state.characters['Alice'].status, 'alive');
  });

  test('addItem tracks an item', async () => {
    const { createState, addItem } = await import('../src/story-state.js');
    const state = createState();
    addItem(state, { name: 'Magic Sword', status: 'active', holder: 'Alice', location: 'forest' });
    assert.equal(state.items['Magic Sword'].status, 'active');
    assert.equal(state.items['Magic Sword'].holder, 'Alice');
  });

  test('updateItem changes item state', async () => {
    const { createState, addItem, updateItem } = await import('../src/story-state.js');
    const state = createState();
    addItem(state, { name: 'Magic Sword', status: 'active', holder: 'Alice', location: 'forest' });
    updateItem(state, 'Magic Sword', { status: 'destroyed', holder: null });
    assert.equal(state.items['Magic Sword'].status, 'destroyed');
    assert.equal(state.items['Magic Sword'].holder, null);
  });

  test('addLocation tracks a location', async () => {
    const { createState, addLocation } = await import('../src/story-state.js');
    const state = createState();
    addLocation(state, { name: 'forest', status: 'accessible' });
    assert.equal(state.locations['forest'].status, 'accessible');
  });

  test('addRevelation adds tagged plot info', async () => {
    const { createState, addRevelation } = await import('../src/story-state.js');
    const state = createState();
    addRevelation(state, { id: 'secret1', info: 'The king is poisoned', visibility: 'hidden', revealInScene: null });
    assert.equal(state.revelations.length, 1);
    assert.equal(state.revelations[0].visibility, 'hidden');
  });

  test('getAvailableRevelations returns only scheduled-for-scene revelations', async () => {
    const { createState, addRevelation, getAvailableRevelations } = await import('../src/story-state.js');
    const state = createState();
    addRevelation(state, { id: 'r1', info: 'Secret A', visibility: 'hidden', revealInScene: 2 });
    addRevelation(state, { id: 'r2', info: 'Secret B', visibility: 'delayed', revealInScene: 5 });
    addRevelation(state, { id: 'r3', info: 'Public C', visibility: 'public', revealInScene: null });
    const available = getAvailableRevelations(state, 2);
    assert.equal(available.length, 2); // r1 (scene 2) + r3 (public, always available)
  });

  test('markRevealed marks a revelation as revealed', async () => {
    const { createState, addRevelation, markRevealed } = await import('../src/story-state.js');
    const state = createState();
    addRevelation(state, { id: 'r1', info: 'Secret', visibility: 'hidden', revealInScene: 2 });
    markRevealed(state, 'r1');
    assert.equal(state.revelations[0].revealed, true);
  });

  test('getCharacterContext returns only what character knows', async () => {
    const { createState, addCharacter, addItem, getCharacterContext } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: ['map exists'] });
    addCharacter(state, { name: 'Bob', status: 'alive', location: 'castle', knowledge: ['king is poisoned'] });
    addItem(state, { name: 'Map', status: 'active', holder: 'Alice', location: 'forest' });
    addItem(state, { name: 'Crown', status: 'active', holder: 'Bob', location: 'castle' });
    const ctx = getCharacterContext(state, 'Alice');
    assert.ok(ctx.characters['Alice']);
    assert.ok(!ctx.characters['Bob']); // Alice doesn't know about Bob unless co-located
    assert.ok(ctx.items['Map']); // Alice holds this
    assert.ok(!ctx.items['Crown']); // Alice doesn't know about this
  });

  test('getCharacterContext includes co-located characters', async () => {
    const { createState, addCharacter, getCharacterContext } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [] });
    addCharacter(state, { name: 'Bob', status: 'alive', location: 'forest', knowledge: [] });
    const ctx = getCharacterContext(state, 'Alice');
    assert.ok(ctx.characters['Alice']);
    assert.ok(ctx.characters['Bob']); // co-located
  });

  test('validate detects contradictions', async () => {
    const { createState, addCharacter, addItem, validate } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'dead', location: 'forest', knowledge: [] });
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: 'forest' });
    const issues = validate(state);
    assert.ok(issues.length > 0); // dead character holding an active item
  });

  test('validate returns empty array for clean state', async () => {
    const { createState, addCharacter, validate } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [] });
    const issues = validate(state);
    assert.deepEqual(issues, []);
  });

  test('serialize and deserialize round-trip', async () => {
    const { createState, addCharacter, addRevelation, serialize, deserialize } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: ['secret'] });
    addRevelation(state, { id: 'r1', info: 'Plot twist', visibility: 'hidden', revealInScene: 3 });
    const json = serialize(state);
    const restored = deserialize(json);
    assert.deepEqual(restored.characters, state.characters);
    assert.deepEqual(restored.revelations, state.revelations);
  });

  test('toPromptContext formats state for Claude', async () => {
    const { createState, addCharacter, toPromptContext } = await import('../src/story-state.js');
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [] });
    const ctx = toPromptContext(state);
    assert.ok(typeof ctx === 'string');
    assert.ok(ctx.includes('Alice'));
    assert.ok(ctx.includes('alive'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/story-state.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 3: Implement story-state.js**

```js
// src/story-state.js

export function createState() {
  return {
    characters: {},
    items: {},
    locations: {},
    revelations: [],
  };
}

export function addCharacter(state, { name, status, location, knowledge, emotional }) {
  state.characters[name] = { name, status: status || 'alive', location: location || null, knowledge: knowledge || [], emotional: emotional || null };
}

export function updateCharacter(state, name, updates) {
  if (!state.characters[name]) return;
  state.characters[name] = { ...state.characters[name], ...updates };
}

export function addItem(state, { name, status, holder, location }) {
  state.items[name] = { name, status: status || 'active', holder: holder || null, location: location || null };
}

export function updateItem(state, name, updates) {
  if (!state.items[name]) return;
  state.items[name] = { ...state.items[name], ...updates };
}

export function addLocation(state, { name, status }) {
  state.locations[name] = { name, status: status || 'accessible' };
}

export function updateLocation(state, name, updates) {
  if (!state.locations[name]) return;
  state.locations[name] = { ...state.locations[name], ...updates };
}

export function addRevelation(state, { id, info, visibility, revealInScene }) {
  state.revelations.push({ id, info, visibility, revealInScene: revealInScene ?? null, revealed: false });
}

export function markRevealed(state, id) {
  const rev = state.revelations.find(r => r.id === id);
  if (rev) rev.revealed = true;
}

export function getAvailableRevelations(state, sceneIndex) {
  return state.revelations.filter(r => {
    if (r.revealed) return false;
    if (r.visibility === 'never_explicit') return false;
    if (r.visibility === 'public') return true;
    if (r.revealInScene !== null && r.revealInScene <= sceneIndex) return true;
    return false;
  });
}

export function getCharacterContext(state, characterName) {
  const char = state.characters[characterName];
  if (!char) return { characters: {}, items: {}, locations: {} };

  const charLocation = char.location;

  // Include self + co-located characters
  const characters = {};
  for (const [name, c] of Object.entries(state.characters)) {
    if (name === characterName || c.location === charLocation) {
      characters[name] = c;
    }
  }

  // Include items held by character or at character's location
  const items = {};
  for (const [name, item] of Object.entries(state.items)) {
    if (item.holder === characterName || item.location === charLocation) {
      items[name] = item;
    }
  }

  // Include character's current location
  const locations = {};
  if (charLocation && state.locations[charLocation]) {
    locations[charLocation] = state.locations[charLocation];
  }

  return { characters, items, locations };
}

export function validate(state) {
  const issues = [];

  // Dead characters shouldn't hold active items
  for (const [itemName, item] of Object.entries(state.items)) {
    if (item.holder && item.status === 'active') {
      const holder = state.characters[item.holder];
      if (holder && holder.status === 'dead') {
        issues.push(`Dead character "${item.holder}" is holding active item "${itemName}"`);
      }
    }
  }

  // Characters at destroyed locations
  for (const [charName, char] of Object.entries(state.characters)) {
    if (char.location && char.status === 'alive') {
      const loc = state.locations[char.location];
      if (loc && loc.status === 'destroyed') {
        issues.push(`Living character "${charName}" is at destroyed location "${char.location}"`);
      }
    }
  }

  // Items at destroyed locations (not held by anyone)
  for (const [itemName, item] of Object.entries(state.items)) {
    if (item.location && !item.holder && item.status === 'active') {
      const loc = state.locations[item.location];
      if (loc && loc.status === 'destroyed') {
        issues.push(`Active item "${itemName}" is at destroyed location "${item.location}"`);
      }
    }
  }

  return issues;
}

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(json) {
  return JSON.parse(json);
}

export function toPromptContext(state) {
  const sections = [];

  const chars = Object.values(state.characters);
  if (chars.length > 0) {
    sections.push('### Characters\n' + chars.map(c =>
      `- ${c.name}: ${c.status}, at ${c.location || 'unknown'}${c.emotional ? `, feeling ${c.emotional}` : ''}${c.knowledge.length ? ` (knows: ${c.knowledge.join('; ')})` : ''}`
    ).join('\n'));
  }

  const items = Object.values(state.items);
  if (items.length > 0) {
    sections.push('### Items\n' + items.map(i =>
      `- ${i.name}: ${i.status}${i.holder ? `, held by ${i.holder}` : i.location ? `, at ${i.location}` : ''}`
    ).join('\n'));
  }

  const locs = Object.values(state.locations);
  if (locs.length > 0) {
    sections.push('### Locations\n' + locs.map(l =>
      `- ${l.name}: ${l.status}`
    ).join('\n'));
  }

  return sections.join('\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/story-state.test.js`
Expected: All 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/story-state.js tests/story-state.test.js
git commit -m "feat: add entity state tracker with character scoping and revelation scheduling"
```

---

### Task 2: History Compressor (`src/compressor.js`)

Compresses scene history into hierarchical summaries for context injection.

**Files:**
- Create: `src/compressor.js`
- Create: `tests/compressor.test.js`

- [ ] **Step 1: Write failing tests for compressor**

```js
// tests/compressor.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('compressor', () => {
  test('buildCompressPrompt includes scene content', async () => {
    const { buildCompressPrompt } = await import('../src/compressor.js');
    const scenes = [{ content: '[narrator]\nAlice entered the dark forest.' }];
    const prompt = buildCompressPrompt(scenes, 'en');
    assert.ok(prompt.includes('Alice entered the dark forest'));
  });

  test('buildCompressPrompt includes multiple scenes', async () => {
    const { buildCompressPrompt } = await import('../src/compressor.js');
    const scenes = [
      { content: '[narrator]\nScene one content.' },
      { content: '[narrator]\nScene two content.' },
    ];
    const prompt = buildCompressPrompt(scenes, 'en');
    assert.ok(prompt.includes('Scene one content'));
    assert.ok(prompt.includes('Scene two content'));
  });

  test('buildCompressPrompt requests JSON output', async () => {
    const { buildCompressPrompt } = await import('../src/compressor.js');
    const scenes = [{ content: 'test' }];
    const prompt = buildCompressPrompt(scenes, 'en');
    assert.ok(prompt.includes('JSON'));
  });

  test('parseCompressorOutput extracts summary fields', async () => {
    const { parseCompressorOutput } = await import('../src/compressor.js');
    const raw = JSON.stringify({
      summary: 'Alice found the map.',
      characterActions: ['Alice picked up the map'],
      plotProgress: ['Map discovered'],
      emotionalArc: 'Tension building',
      stateChanges: { characters: [{ name: 'Alice', location: 'cave' }], items: [{ name: 'Map', holder: 'Alice' }] },
    });
    const result = await parseCompressorOutput(raw);
    assert.equal(result.summary, 'Alice found the map.');
    assert.ok(result.characterActions.length > 0);
    assert.ok(result.stateChanges.characters.length > 0);
  });

  test('parseCompressorOutput handles code fences', async () => {
    const { parseCompressorOutput } = await import('../src/compressor.js');
    const json = JSON.stringify({ summary: 'test', characterActions: [], plotProgress: [], emotionalArc: '', stateChanges: { characters: [], items: [] } });
    const raw = '```json\n' + json + '\n```';
    const result = await parseCompressorOutput(raw);
    assert.equal(result.summary, 'test');
  });

  test('buildHistoryContext formats compressed scenes', async () => {
    const { buildHistoryContext } = await import('../src/compressor.js');
    const compressed = [
      { sceneIndex: 0, summary: 'Alice enters forest.', characterActions: ['Alice walked in'], plotProgress: ['Journey begins'], emotionalArc: 'Curious' },
      { sceneIndex: 1, summary: 'Alice meets wolf.', characterActions: ['Wolf appears'], plotProgress: ['Conflict introduced'], emotionalArc: 'Afraid' },
    ];
    const ctx = buildHistoryContext(compressed);
    assert.ok(typeof ctx === 'string');
    assert.ok(ctx.includes('Alice enters forest'));
    assert.ok(ctx.includes('Alice meets wolf'));
    assert.ok(ctx.includes('Scene 1'));
    assert.ok(ctx.includes('Scene 2'));
  });

  test('buildHistoryContext returns empty string for no history', async () => {
    const { buildHistoryContext } = await import('../src/compressor.js');
    assert.equal(buildHistoryContext([]), '');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/compressor.test.js`
Expected: All tests FAIL

- [ ] **Step 3: Implement compressor.js**

```js
// src/compressor.js
import { callClaude } from './claude.js';

export function buildCompressPrompt(scenes, lang = 'en') {
  const sceneTexts = scenes.map((s, i) =>
    `--- Scene ${i + 1} ---\n${s.content}`
  ).join('\n\n');

  const instructions = lang === 'cn'
    ? [
        '你是叙事分析助手。将以下场景压缩为结构化摘要。',
        '',
        '## 场景内容',
        '',
        sceneTexts,
        '',
        '## 输出',
        '',
        '仅返回有效JSON（不要markdown，不要评论）：',
        '```json',
        '{',
        '  "summary": "1-2句总结所有场景中发生的事",',
        '  "characterActions": ["角色做了什么的要点列表"],',
        '  "plotProgress": ["推进了哪些情节线"],',
        '  "emotionalArc": "当前的情感基调",',
        '  "stateChanges": {',
        '    "characters": [{"name": "角色名", "status": "状态", "location": "位置", "knowledge": ["新知识"], "emotional": "情感"}],',
        '    "items": [{"name": "物品名", "status": "状态", "holder": "持有者"}]',
        '  }',
        '}',
        '```',
      ]
    : [
        'You are a narrative analysis assistant. Compress the following scenes into a structured summary.',
        '',
        '## Scene Content',
        '',
        sceneTexts,
        '',
        '## Output',
        '',
        'Return ONLY valid JSON (no markdown, no commentary):',
        '```json',
        '{',
        '  "summary": "1-2 sentence summary of what happened across all scenes",',
        '  "characterActions": ["bullet points of what characters did"],',
        '  "plotProgress": ["which plot threads advanced"],',
        '  "emotionalArc": "the current emotional tone",',
        '  "stateChanges": {',
        '    "characters": [{"name": "Name", "status": "alive|dead|injured", "location": "where", "knowledge": ["new info learned"], "emotional": "feeling"}],',
        '    "items": [{"name": "Item", "status": "active|lost|destroyed", "holder": "who has it"}]',
        '  }',
        '}',
        '```',
      ];

  return instructions.join('\n');
}

function cleanRaw(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

export async function parseCompressorOutput(raw) {
  const cleaned = cleanRaw(raw);
  try { return JSON.parse(cleaned); } catch {}
  const extracted = extractJsonObject(cleaned);
  if (extracted) return extracted;
  throw new Error('Failed to parse compressor output');
}

export async function compressScenes(scenes, lang = 'en') {
  const prompt = buildCompressPrompt(scenes, lang);
  const raw = await callClaude(prompt);
  return await parseCompressorOutput(raw);
}

export function buildHistoryContext(compressedScenes) {
  if (!compressedScenes.length) return '';

  return compressedScenes.map(c =>
    `Scene ${(c.sceneIndex ?? 0) + 1}: ${c.summary}\n  Actions: ${(c.characterActions || []).join('; ')}\n  Plot: ${(c.plotProgress || []).join('; ')}\n  Tone: ${c.emotionalArc || 'neutral'}`
  ).join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/compressor.test.js`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/compressor.js tests/compressor.test.js
git commit -m "feat: add dynamic history compression for scene context"
```

---

### Task 3: Prose Consistency Checker (`src/consistency.js`)

Detects repetitive patterns and requests rewrites.

**Files:**
- Create: `src/consistency.js`
- Create: `tests/consistency.test.js`

- [ ] **Step 1: Write failing tests for consistency checker**

```js
// tests/consistency.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('consistency', () => {
  test('findRepetitiveOpeners detects repeated sentence starts', async () => {
    const { findRepetitiveOpeners } = await import('../src/consistency.js');
    const content = 'She walked to the door. She opened it. She stepped outside. She looked up. He ran away.';
    const issues = findRepetitiveOpeners(content);
    assert.ok(issues.length > 0);
    assert.ok(issues[0].includes('She'));
  });

  test('findRepetitiveOpeners ignores varied openers', async () => {
    const { findRepetitiveOpeners } = await import('../src/consistency.js');
    const content = 'The sun rose. Birds chirped loudly. A cold wind blew. She smiled.';
    const issues = findRepetitiveOpeners(content);
    assert.deepEqual(issues, []);
  });

  test('findOverusedPhrases detects repeated phrases in current scene', async () => {
    const { findOverusedPhrases } = await import('../src/consistency.js');
    const content = 'Her heart raced. She felt her heart raced again. Once more her heart raced.';
    const issues = findOverusedPhrases(content);
    assert.ok(issues.length > 0);
  });

  test('findOverusedPhrases returns empty for unique content', async () => {
    const { findOverusedPhrases } = await import('../src/consistency.js');
    const content = 'The castle stood tall. Rain poured from dark clouds. A horse galloped past.';
    const issues = findOverusedPhrases(content);
    assert.deepEqual(issues, []);
  });

  test('checkMotifCooldown flags recently used motifs', async () => {
    const { checkMotifCooldown } = await import('../src/consistency.js');
    const tracker = { 'a shiver ran down': 0 };
    const content = 'A shiver ran down her spine as she entered.';
    const issues = checkMotifCooldown(content, tracker, 1);
    assert.ok(issues.length > 0);
  });

  test('checkMotifCooldown allows motifs after cooldown', async () => {
    const { checkMotifCooldown } = await import('../src/consistency.js');
    const tracker = { 'a shiver ran down': 0 };
    const content = 'A shiver ran down her spine.';
    const issues = checkMotifCooldown(content, tracker, 4); // 4 scenes later
    assert.deepEqual(issues, []);
  });

  test('updateMotifTracker records phrases from scene', async () => {
    const { updateMotifTracker } = await import('../src/consistency.js');
    const tracker = {};
    updateMotifTracker(tracker, 'Her eyes widened in disbelief. The world seemed to stop.', 2);
    assert.ok(Object.keys(tracker).length > 0);
  });

  test('checkConsistency combines all checks', async () => {
    const { checkConsistency } = await import('../src/consistency.js');
    const content = 'She ran. She jumped. She flew. She landed. She laughed.';
    const result = checkConsistency(content, {}, 0);
    assert.ok(Array.isArray(result.issues));
    assert.ok(result.issues.length > 0);
  });

  test('checkConsistency returns empty issues for clean content', async () => {
    const { checkConsistency } = await import('../src/consistency.js');
    const content = 'The door creaked open. Rain fell softly. A distant bell tolled.';
    const result = checkConsistency(content, {}, 0);
    assert.deepEqual(result.issues, []);
  });

  test('buildRewritePrompt includes issues in prompt', async () => {
    const { buildRewritePrompt } = await import('../src/consistency.js');
    const prompt = buildRewritePrompt('She ran. She jumped.', ['Repetitive opener: "She" used 2 times'], 'en');
    assert.ok(prompt.includes('She ran'));
    assert.ok(prompt.includes('Repetitive opener'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/consistency.test.js`
Expected: All tests FAIL

- [ ] **Step 3: Implement consistency.js**

```js
// src/consistency.js
import { callClaude } from './claude.js';

const OPENER_THRESHOLD = 3; // flag if same opener appears 3+ times
const MOTIF_COOLDOWN = 3;   // scenes before a motif can repeat
const PHRASE_MIN_WORDS = 3;

function getSentences(text) {
  return text
    .replace(/\[narrator\]|\[character:[^\]]*\]|\[player\]|\[choice\]/g, '')
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export function findRepetitiveOpeners(content) {
  const sentences = getSentences(content);
  const openers = {};
  for (const s of sentences) {
    const firstWord = s.split(/\s+/)[0];
    if (!firstWord) continue;
    openers[firstWord] = (openers[firstWord] || 0) + 1;
  }

  const issues = [];
  for (const [word, count] of Object.entries(openers)) {
    if (count >= OPENER_THRESHOLD) {
      issues.push(`Repetitive opener: "${word}" starts ${count} sentences`);
    }
  }
  return issues;
}

export function findOverusedPhrases(content) {
  const sentences = getSentences(content);
  const phrases = {};

  for (const s of sentences) {
    const words = s.toLowerCase().split(/\s+/);
    for (let len = PHRASE_MIN_WORDS; len <= Math.min(5, words.length); len++) {
      for (let i = 0; i <= words.length - len; i++) {
        const phrase = words.slice(i, i + len).join(' ');
        phrases[phrase] = (phrases[phrase] || 0) + 1;
      }
    }
  }

  const issues = [];
  for (const [phrase, count] of Object.entries(phrases)) {
    if (count >= 3) {
      issues.push(`Overused phrase: "${phrase}" appears ${count} times`);
    }
  }
  return issues;
}

export function checkMotifCooldown(content, tracker, sceneIndex) {
  const issues = [];
  const lower = content.toLowerCase();
  for (const [motif, lastScene] of Object.entries(tracker)) {
    if (lower.includes(motif) && (sceneIndex - lastScene) < MOTIF_COOLDOWN) {
      issues.push(`Motif "${motif}" reused too soon (last used ${sceneIndex - lastScene} scenes ago, cooldown is ${MOTIF_COOLDOWN})`);
    }
  }
  return issues;
}

export function updateMotifTracker(tracker, content, sceneIndex) {
  const sentences = getSentences(content);
  for (const s of sentences) {
    const words = s.toLowerCase().split(/\s+/);
    // Track 4-5 word phrases as potential motifs
    for (let len = 4; len <= Math.min(5, words.length); len++) {
      for (let i = 0; i <= words.length - len; i++) {
        const phrase = words.slice(i, i + len).join(' ');
        tracker[phrase] = sceneIndex;
      }
    }
  }
}

export function checkConsistency(content, motifTracker, sceneIndex) {
  const issues = [
    ...findRepetitiveOpeners(content),
    ...findOverusedPhrases(content),
    ...checkMotifCooldown(content, motifTracker, sceneIndex),
  ];
  return { issues };
}

export function buildRewritePrompt(content, issues, lang = 'en') {
  const issueList = issues.map(i => `- ${i}`).join('\n');

  if (lang === 'cn') {
    return [
      '以下场景内容存在写作质量问题。请修复这些问题，同时保持故事内容、JSON结构和格式不变。',
      '',
      '## 问题',
      '',
      issueList,
      '',
      '## 原始内容',
      '',
      content,
      '',
      '## 指令',
      '',
      '修复上述问题。变化句子开头，用同义词替换重复的短语，丰富写作手法。',
      '仅返回修正后的场景内容，保持原格式不变。',
    ].join('\n');
  }

  return [
    'The following scene content has writing quality issues. Fix them while preserving the story content, JSON structure, and format.',
    '',
    '## Issues',
    '',
    issueList,
    '',
    '## Original Content',
    '',
    content,
    '',
    '## Instructions',
    '',
    'Fix the issues above. Vary sentence openers, replace repeated phrases with synonyms, diversify the prose.',
    'Return ONLY the corrected scene content, preserving the original format.',
  ].join('\n');
}

export async function rewriteForConsistency(content, issues, lang = 'en') {
  const prompt = buildRewritePrompt(content, issues, lang);
  return await callClaude(prompt);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/consistency.test.js`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/consistency.js tests/consistency.test.js
git commit -m "feat: add prose consistency checker with motif cooldown tracking"
```

---

### Task 4: Planning Agent (`src/planner.js` + prompt templates)

Takes an outline and produces an enriched plan with event assignments, thread interweaving, and revelation scheduling.

**Files:**
- Create: `src/planner.js`
- Create: `prompts/plan.md`
- Create: `prompts/plan-cn.md`
- Create: `tests/planner.test.js`

- [ ] **Step 1: Create prompt templates**

```markdown
<!-- prompts/plan.md -->
You are a story planning agent. Given a story outline, produce a detailed scene-by-scene execution plan.

## Story Outline

{{outline}}

## Your Task

For each scene in the outline, produce:
1. **Events**: Specific events that happen (not just the summary — break it into beats)
2. **Threads**: Which plot threads this scene advances
3. **Characters**: Who appears, their emotional state entering the scene, what they learn
4. **Items**: Any items that change state (acquired, lost, used, destroyed)
5. **Revelations**: Secrets or plot info with visibility tags
6. **Pacing**: Whether this scene is fast/slow/building/climactic

Also produce:
- A list of all characters with initial states (status, location, knowledge)
- A list of all significant items with initial states
- A list of all locations
- A revelation schedule: secrets tagged as public/hidden/delayed/never_explicit with target reveal scenes

## Output

Return ONLY valid JSON (no markdown, no commentary):

```json
{
  "characters": [
    { "name": "Name", "status": "alive", "location": "starting location", "knowledge": ["what they know at start"], "emotional": "initial emotional state" }
  ],
  "items": [
    { "name": "Item Name", "status": "active", "holder": "who has it or null", "location": "where it is" }
  ],
  "locations": [
    { "name": "Location Name", "status": "accessible" }
  ],
  "revelations": [
    { "id": "rev_1", "info": "description of the secret", "visibility": "hidden", "revealInScene": 3 }
  ],
  "scenes": [
    {
      "sceneIndex": 0,
      "events": ["beat 1", "beat 2"],
      "threads": ["main plot", "romance subplot"],
      "characterChanges": [{ "name": "Name", "enteringState": "calm", "learns": ["new info"], "locationChange": "forest -> cave" }],
      "itemChanges": [{ "name": "Item", "change": "acquired by Alice" }],
      "revealIds": ["rev_1"],
      "pacing": "building"
    }
  ]
}
```

## Rules

- Every scene must have at least 1 event
- Revelations tagged "hidden" must have a revealInScene
- Revelations tagged "public" have revealInScene: null (always available)
- Revelations tagged "never_explicit" are never directly stated
- Characters should only learn things when they're present in the scene
- Track location changes explicitly
```

```markdown
<!-- prompts/plan-cn.md -->
你是一个故事规划代理。根据故事大纲，制定详细的逐场景执行计划。

## 故事大纲

{{outline}}

## 你的任务

为大纲中的每个场景生成：
1. **事件**：发生的具体事件（不只是摘要——拆分为节拍）
2. **线索**：这个场景推进了哪些情节线索
3. **角色**：谁出场，进入场景时的情感状态，他们学到了什么
4. **物品**：任何状态变化的物品（获得、丢失、使用、毁坏）
5. **揭示**：带有可见性标签的秘密或情节信息
6. **节奏**：这个场景是快速/缓慢/铺垫/高潮

同时生成：
- 所有角色的初始状态列表（状态、位置、知识）
- 所有重要物品的初始状态列表
- 所有地点列表
- 揭示时间表：标记为public/hidden/delayed/never_explicit的秘密及目标揭示场景

## 输出

仅返回有效的JSON（不要markdown，不要评论）：

```json
{
  "characters": [
    { "name": "角色名", "status": "alive", "location": "起始位置", "knowledge": ["开始时知道什么"], "emotional": "初始情感状态" }
  ],
  "items": [
    { "name": "物品名", "status": "active", "holder": "谁持有或null", "location": "在哪里" }
  ],
  "locations": [
    { "name": "地点名", "status": "accessible" }
  ],
  "revelations": [
    { "id": "rev_1", "info": "秘密的描述", "visibility": "hidden", "revealInScene": 3 }
  ],
  "scenes": [
    {
      "sceneIndex": 0,
      "events": ["节拍1", "节拍2"],
      "threads": ["主线", "感情副线"],
      "characterChanges": [{ "name": "角色名", "enteringState": "平静", "learns": ["新信息"], "locationChange": "森林 -> 洞穴" }],
      "itemChanges": [{ "name": "物品", "change": "被Alice获得" }],
      "revealIds": ["rev_1"],
      "pacing": "building"
    }
  ]
}
```

## 规则

- 每个场景必须有至少1个事件
- 标记为"hidden"的揭示必须有revealInScene
- 标记为"public"的揭示revealInScene为null（始终可用）
- 标记为"never_explicit"的揭示永远不会直接陈述
- 角色只能在他们出现的场景中学到东西
- 明确跟踪位置变化
- 所有内容必须用中文撰写
```

- [ ] **Step 2: Write failing tests for planner**

```js
// tests/planner.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('planner', () => {
  test('buildPlanPrompt inserts outline into template', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: 'Test Story', synopsis: 'A test', episodes: [{ title: 'Ep1', scenePlan: [{ summary: 'Scene 1' }] }] };
    const prompt = buildPlanPrompt(outline);
    assert.ok(prompt.includes('Test Story'));
    assert.ok(prompt.includes('Scene 1'));
  });

  test('buildPlanPrompt uses CN template for cn lang', async () => {
    const { buildPlanPrompt } = await import('../src/planner.js');
    const outline = { title: '测试', episodes: [] };
    const prompt = buildPlanPrompt(outline, 'cn');
    assert.ok(prompt.includes('故事规划代理'));
  });

  test('parsePlan validates required structure', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const valid = {
      characters: [{ name: 'Alice', status: 'alive', location: 'forest', knowledge: [], emotional: 'calm' }],
      items: [],
      locations: [{ name: 'forest', status: 'accessible' }],
      revelations: [],
      scenes: [{ sceneIndex: 0, events: ['Alice arrives'], threads: ['main'], characterChanges: [], itemChanges: [], revealIds: [], pacing: 'building' }],
    };
    const result = await parsePlan(JSON.stringify(valid));
    assert.equal(result.characters.length, 1);
    assert.equal(result.scenes.length, 1);
  });

  test('parsePlan throws on missing scenes', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const invalid = { characters: [], items: [], locations: [], revelations: [] };
    await assert.rejects(() => parsePlan(JSON.stringify(invalid)), /scenes/);
  });

  test('parsePlan throws on scene without events', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const invalid = {
      characters: [], items: [], locations: [], revelations: [],
      scenes: [{ sceneIndex: 0, events: [], threads: [], characterChanges: [], itemChanges: [], revealIds: [], pacing: 'building' }],
    };
    await assert.rejects(() => parsePlan(JSON.stringify(invalid)), /events/);
  });

  test('parsePlan strips code fences', async () => {
    const { parsePlan } = await import('../src/planner.js');
    const valid = {
      characters: [], items: [], locations: [], revelations: [],
      scenes: [{ sceneIndex: 0, events: ['beat'], threads: [], characterChanges: [], itemChanges: [], revealIds: [], pacing: 'slow' }],
    };
    const wrapped = '```json\n' + JSON.stringify(valid) + '\n```';
    const result = await parsePlan(wrapped);
    assert.equal(result.scenes.length, 1);
  });

  test('initStateFromPlan creates state from plan data', async () => {
    const { initStateFromPlan } = await import('../src/planner.js');
    const plan = {
      characters: [{ name: 'Alice', status: 'alive', location: 'forest', knowledge: ['map'], emotional: 'calm' }],
      items: [{ name: 'Sword', status: 'active', holder: 'Alice', location: 'forest' }],
      locations: [{ name: 'forest', status: 'accessible' }],
      revelations: [{ id: 'r1', info: 'Secret', visibility: 'hidden', revealInScene: 2 }],
      scenes: [],
    };
    const state = initStateFromPlan(plan);
    assert.ok(state.characters['Alice']);
    assert.ok(state.items['Sword']);
    assert.ok(state.locations['forest']);
    assert.equal(state.revelations.length, 1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/planner.test.js`
Expected: All tests FAIL

- [ ] **Step 4: Implement planner.js**

```js
// src/planner.js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude } from './claude.js';
import { createState, addCharacter, addItem, addLocation, addRevelation } from './story-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(__dirname, '..', 'prompts', 'plan.md');
const PLAN_PATH_CN = join(__dirname, '..', 'prompts', 'plan-cn.md');

export function buildPlanPrompt(outline, lang = 'en') {
  const templateFile = lang === 'cn' ? PLAN_PATH_CN : PLAN_PATH;
  const template = readFileSync(templateFile, 'utf8');
  return template.replace('{{outline}}', JSON.stringify(outline, null, 2));
}

function cleanRaw(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

export async function parsePlan(raw) {
  const cleaned = cleanRaw(raw);
  let data;
  try { data = JSON.parse(cleaned); } catch {}
  if (!data) data = extractJsonObject(cleaned);
  if (!data) throw new Error('Failed to parse plan JSON');

  if (!data.scenes || !Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error('Plan must have at least 1 scene in scenes array');
  }
  for (let i = 0; i < data.scenes.length; i++) {
    if (!data.scenes[i].events || data.scenes[i].events.length === 0) {
      throw new Error(`Scene ${i} must have at least 1 entry in events`);
    }
  }

  return data;
}

export function initStateFromPlan(plan) {
  const state = createState();

  for (const c of (plan.characters || [])) {
    addCharacter(state, c);
  }
  for (const i of (plan.items || [])) {
    addItem(state, i);
  }
  for (const l of (plan.locations || [])) {
    addLocation(state, l);
  }
  for (const r of (plan.revelations || [])) {
    addRevelation(state, r);
  }

  return state;
}

export async function generatePlan(outline, options = {}) {
  const lang = options.lang || 'en';
  const prompt = buildPlanPrompt(outline, lang);
  const raw = await callClaude(prompt);
  return await parsePlan(raw);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/planner.test.js`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/planner.js prompts/plan.md prompts/plan-cn.md tests/planner.test.js
git commit -m "feat: add planning agent with event assignment and revelation scheduling"
```

---

### Task 5: Integrate Into Writer Pipeline (`src/writer.js`)

Wire all 4 new modules into `generateStory` and extend `buildScenePrompt` with state/history/revelations context.

**Files:**
- Modify: `src/writer.js`

- [ ] **Step 1: Add imports at top of writer.js**

Add after the existing imports (line 5):

```js
import { generatePlan, initStateFromPlan } from './planner.js';
import { compressScenes, buildHistoryContext } from './compressor.js';
import { updateCharacter, updateItem, getAvailableRevelations, markRevealed, getCharacterContext, toPromptContext, validate } from './story-state.js';
import { checkConsistency, rewriteForConsistency, updateMotifTracker } from './consistency.js';
```

- [ ] **Step 2: Extend buildScenePrompt to accept narrative context**

Replace the existing `buildScenePrompt` function (lines 120-162) with this version that accepts an optional `narrativeContext` parameter:

```js
export function buildScenePrompt(outline, sceneIndex, scenePlan, totalScenes, lang = 'en', styleKey, narrativeContext) {
  const templateFile = lang === 'cn' ? SCENES_PATH_CN : SCENES_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const style = getStyle(styleKey);
  if (style) {
    template += `\n\n## Writing Style\n\n${style.scene}\n`;
  }

  // Inject narrative intelligence context
  if (narrativeContext) {
    if (narrativeContext.history) {
      template += `\n\n## Story So Far\n\n${narrativeContext.history}\n`;
    }
    if (narrativeContext.stateContext) {
      template += `\n\n## Current World State\n\n${narrativeContext.stateContext}\n`;
    }
    if (narrativeContext.revelations && narrativeContext.revelations.length > 0) {
      const revList = narrativeContext.revelations.map(r =>
        `- [${r.visibility}] ${r.info}`
      ).join('\n');
      template += `\n\n## Available Revelations\n\nYou may weave these into the scene naturally:\n${revList}\n`;
    }
    if (narrativeContext.events && narrativeContext.events.length > 0) {
      template += `\n\n## Scene Beats\n\nThis scene should cover these beats:\n${narrativeContext.events.map(e => `- ${e}`).join('\n')}\n`;
    }
    if (narrativeContext.pacing) {
      template += `\n\n## Pacing\n\nThis scene's pacing should be: ${narrativeContext.pacing}\n`;
    }
    if (narrativeContext.consistencyNotes && narrativeContext.consistencyNotes.length > 0) {
      template += `\n\n## Writing Notes\n\nAvoid these patterns:\n${narrativeContext.consistencyNotes.map(n => `- ${n}`).join('\n')}\n`;
    }
  }

  // Build a compact outline summary (without scenePlan details to save tokens)
  const outlineSummary = {
    title: outline.title,
    synopsis: outline.synopsis,
    genres: outline.genres,
    episodes: outline.episodes.map(ep => ({
      title: ep.title,
      scenes: ep.scenePlan.map((s, i) => `Scene ${i}: ${s.summary} (${s.sceneType})`),
    })),
  };

  template = template.replace('{{outline}}', JSON.stringify(outlineSummary, null, 2));
  template = template.replace('{{sceneIndex}}', String(sceneIndex + 1));
  template = template.replace('{{totalScenes}}', String(totalScenes));
  template = template.replace('{{sceneSummary}}', scenePlan.summary);
  template = template.replace('{{sceneType}}', scenePlan.sceneType || 'NARRATIVE');

  // Handle conditional sections
  if (scenePlan.hasChoices && scenePlan.choiceTexts) {
    template = template.replace('{{#hasChoices}}', '').replace('{{/hasChoices}}', '');
    template = template.replace('{{choiceTexts}}', scenePlan.choiceTexts.join(', '));
  } else {
    template = template.replace(/\{\{#hasChoices\}\}.*?\{\{\/hasChoices\}\}/gs, '');
  }

  if (scenePlan.isConclusion) {
    template = template.replace('{{#isConclusion}}', '').replace('{{/isConclusion}}', '');
    template = template.replace('{{conclusionType}}', scenePlan.conclusionType || 'EPISODE_END');
    template = template.replace('{{ending}}', scenePlan.ending || 'GOOD');
  } else {
    template = template.replace(/\{\{#isConclusion\}\}.*?\{\{\/isConclusion\}\}/gs, '');
  }

  return template;
}
```

- [ ] **Step 3: Extend generateScene to pass narrativeContext through**

Replace the existing `generateScene` function (lines 171-177):

```js
export async function generateScene(outline, sceneIndex, scenePlan, totalScenes, options = {}) {
  const lang = options.lang || 'en';
  const style = options.style;
  const narrativeContext = options.narrativeContext;
  const prompt = buildScenePrompt(outline, sceneIndex, scenePlan, totalScenes, lang, style, narrativeContext);
  const raw = await callClaude(prompt);
  return await parseScene(raw);
}
```

- [ ] **Step 4: Rewrite generateStory with full pipeline**

Replace the existing `generateStory` function (lines 221-275):

```js
export async function generateStory(materials, options = {}) {
  const lang = options.lang || 'en';
  let style = options.style;
  const log = options.log || (() => {});

  // Auto-pick style if not specified
  if (!style || style === 'default') {
    log('Selecting best writing style for this story...');
    const picked = await pickStyle(materials);
    if (picked) {
      const def = getStyle(picked);
      style = picked;
      log(`Selected style: ${def.name}`);
    }
  }

  // Step 1: Generate outline
  log('Generating story outline...');
  const outline = await generateOutline(materials, { lang, style });
  if (options.onOutline) options.onOutline(outline);
  log(`Outline: "${outline.title}" — ${outline.episodes[0].scenePlan.length} scenes planned`);

  // Step 2: Generate plan (planning agent)
  log('Planning scene details, events, and revelations...');
  const plan = await generatePlan(outline, { lang });
  if (options.onPlan) options.onPlan(plan);
  log(`Plan: ${plan.scenes.length} scenes planned, ${plan.revelations.length} revelations scheduled`);

  // Step 3: Initialize story state from plan
  const state = initStateFromPlan(plan);
  const motifTracker = {};
  const compressedHistory = [];

  // Step 4: Generate each scene with full narrative intelligence
  const story = {
    title: outline.title,
    synopsis: outline.synopsis,
    fandom: outline.fandom || null,
    genres: outline.genres || [],
    tags: outline.tags || [],
    characterQuestions: outline.characterQuestions || [],
    episodes: [],
  };

  for (const ep of outline.episodes) {
    const episode = { title: ep.title, scenes: [] };
    const totalScenes = ep.scenePlan.length;

    for (let i = 0; i < totalScenes; i++) {
      const scenePlan = ep.scenePlan[i];
      const planScene = plan.scenes[i] || {};

      log(`Writing scene ${i + 1}/${totalScenes}: ${scenePlan.summary.slice(0, 60)}...`);

      // Build narrative context for this scene
      const history = buildHistoryContext(compressedHistory);
      const availableRevs = getAvailableRevelations(state, i);
      const stateContext = toPromptContext(state);

      // Validate state before generating
      const stateIssues = validate(state);
      if (stateIssues.length > 0) {
        log(`  State warnings: ${stateIssues.join('; ')}`);
      }

      const narrativeContext = {
        history: history || undefined,
        stateContext: stateContext || undefined,
        revelations: availableRevs.length > 0 ? availableRevs : undefined,
        events: planScene.events || undefined,
        pacing: planScene.pacing || undefined,
      };

      // Generate scene
      let scene = await generateScene(outline, i, scenePlan, totalScenes, { lang, style, narrativeContext });

      // Check prose consistency and rewrite if needed
      const consistency = checkConsistency(scene.content, motifTracker, i);
      if (consistency.issues.length > 0) {
        log(`  Consistency issues found: ${consistency.issues.length}, rewriting...`);
        const rewritten = await rewriteForConsistency(scene.content, consistency.issues, lang);
        scene.content = rewritten;
      }

      // Update motif tracker
      updateMotifTracker(motifTracker, scene.content, i);

      // Update state from plan's character/item changes
      for (const cc of (planScene.characterChanges || [])) {
        const updates = {};
        if (cc.enteringState) updates.emotional = cc.enteringState;
        if (cc.locationChange) {
          const parts = cc.locationChange.split('->').map(s => s.trim());
          if (parts.length === 2) updates.location = parts[1];
        }
        if (cc.learns && cc.learns.length > 0) {
          const char = state.characters[cc.name];
          if (char) updates.knowledge = [...(char.knowledge || []), ...cc.learns];
        }
        updateCharacter(state, cc.name, updates);
      }
      for (const ic of (planScene.itemChanges || [])) {
        if (state.items[ic.name]) {
          updateItem(state, ic.name, { status: ic.status || state.items[ic.name].status });
        }
      }

      // Mark revelations as revealed
      for (const revId of (planScene.revealIds || [])) {
        markRevealed(state, revId);
      }

      // Compress this scene for future context
      try {
        const compressed = await compressScenes([scene], lang);
        compressedHistory.push({ sceneIndex: i, ...compressed });
      } catch (err) {
        log(`  Warning: history compression failed: ${err.message}`);
        compressedHistory.push({ sceneIndex: i, summary: scenePlan.summary, characterActions: [], plotProgress: [], emotionalArc: '' });
      }

      if (options.onState) options.onState(state);
      episode.scenes.push(scene);
    }

    story.episodes.push(episode);
  }

  // Validate final story
  if (!story.episodes.length) throw new Error('Story must have at least 1 episode');
  for (const ep of story.episodes) {
    if (!ep.scenes.length) throw new Error(`Episode "${ep.title}" has no scenes`);
  }

  return story;
}
```

- [ ] **Step 5: Run all tests to verify nothing broke**

Run: `node --test tests/*.test.js`
Expected: All existing tests PASS (the writer tests test `buildOutlinePrompt`, `parseOutline`, `buildScenePrompt`, `parseScene` — `buildScenePrompt` now has an extra optional param that defaults to `undefined`, so existing calls still work)

- [ ] **Step 6: Commit**

```bash
git add src/writer.js
git commit -m "feat: integrate narrative intelligence pipeline into story generation"
```

---

### Task 6: Update Worker to Save New Artifacts (`src/worker.js`)

Save plan and state artifacts for job resumption.

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 1: Update processJob to save plan and pass onPlan/onState callbacks**

In `src/worker.js`, replace the story generation block (lines 55-65) with:

```js
    // Step 2: Write (resume if story already saved)
    let story = loadArtifact(jobId, 'story.json');
    if (!story) {
      updateJob(jobId, { status: 'writing' });
      story = await generateStory(materials, {
        lang,
        style,
        log,
        onOutline: (outline) => saveArtifact(jobId, 'outline.json', outline),
        onPlan: (plan) => saveArtifact(jobId, 'plan.json', plan),
        onState: (state) => saveArtifact(jobId, 'state.json', state),
      });
      saveArtifact(jobId, 'story.json', story);
      log(`Generated "${story.title}" (${story.episodes[0]?.scenes?.length || 0} scenes)`);
    } else {
      log(`Resuming — story "${story.title}" already generated`);
    }
```

- [ ] **Step 2: Run all tests**

Run: `node --test tests/*.test.js`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/worker.js
git commit -m "feat: save plan and state artifacts for job resumption"
```

---

### Task 7: Final Integration Test and Push

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/*.test.js`
Expected: All tests PASS (existing 121 + new planner/state/compressor/consistency tests)

- [ ] **Step 2: Verify styles still work**

Run: `node bin/story-writer.js styles | head -10`
Expected: Shows categories and styles as before

- [ ] **Step 3: Commit everything and push**

```bash
git push
```
