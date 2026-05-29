import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from './llm.js';
import { tryParseJson } from './json.js';
import { buildReferenceBlock } from './references.js';
import { buildBibleBlock, buildProseBlock } from './story-bible.js';
import { buildSelftellDirective } from './selftell.js';
import {
  createState,
  addCharacter,
  addItem,
  addLocation,
  addRevelation,
} from './drama-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// JSON extraction helpers are shared via ./json.js.

// ─── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Reads the plan prompt template for the given language and replaces {{outline}}
 * with the JSON-serialized outline.
 * @param {object} outline
 * @param {string} lang - 'en' or 'cn'
 * @returns {string}
 */
export function buildPlanPrompt(outline, lang = 'cn', genre = '', referenceCharacter = '', referenceEvent = '', options = {}) {
  const templatePath = join(__dirname, '..', 'prompts', 'plan.md');
  let template = readFileSync(templatePath, 'utf8');
  if (genre) {
    const section = lang === 'cn'
      ? `\n\n## 题材要求\n\n这个故事是**${genre}**类型的小说。所有场景规划、角色行为、事件设计都必须符合此类型的特征。\n`
      : `\n\n## Novel Type Requirement\n\nThis story is a **${genre}** novel. All scene planning, character behavior, and event design must align with this genre/type.\n`;
    template += section;
  }
  if (referenceCharacter) {
    template += buildReferenceBlock({
      kind: 'character', lang, content: referenceCharacter,
      instruction: lang === 'cn'
        ? '以下角色已预先定义并必须出现在本故事中。在 characters 数组中请以其姓名、身份、动机与背景填入一项，并确保其行为、情绪、弧光在所有 clips.events 中与以下描述一致。不得改名或替换。'
        : 'The following character is predefined and MUST appear in this story. Include them in the characters array using their exact name, identity, motivations, and background, and ensure their behavior, emotions, and arc across all clips.events remain consistent with the description below. Do NOT rename or replace them.',
    });
  }
  if (referenceEvent) {
    template += buildReferenceBlock({
      kind: 'event', lang, content: referenceEvent,
      instruction: lang === 'cn'
        ? '以下事件已预先定义并必须在本故事中发生。请将其编入 clips.events 中具体的场景节点，确保相关角色的情绪、revelations（揭示）与后续情节弧线都与该事件及其后果保持一致。不要淡化或改写事件的核心事实。'
        : 'The following event is predefined and MUST occur in this story. Schedule it into specific clips.events entries, and ensure the emotional states, revelations, and subsequent plot arcs of affected characters remain consistent with this event and its aftermath. Do NOT sanitize or rewrite its core facts.',
    });
  }
  if (options.bible && options.fidelity) {
    template += '\n\n' + buildBibleBlock(options.bible, options.fidelity) + '\n';
    if (options.chapters && options.aggregateChapterRange) {
      const proseBlock = buildProseBlock(options.chapters, options.aggregateChapterRange, options.fidelity, 4000);
      if (proseBlock) template += '\n\n' + proseBlock + '\n';
    }
  }
  if (options.mode === 'selftell') {
    template += '\n' + buildSelftellDirective(lang, 'plan');
  }
  return template.replace('{{outline}}', () => JSON.stringify(outline, null, 2));
}

// ─── Output parser ─────────────────────────────────────────────────────────────

/**
 * Strips code fences, parses JSON, and validates the plan structure.
 * Throws if clips is missing/empty or any scene has no events.
 * @param {string} raw
 * @returns {object}
 */
export function parsePlan(raw) {
  const plan = tryParseJson(raw);

  if (!plan) {
    throw new Error('Failed to parse plan output as JSON');
  }

  // Validate clips array exists and is non-empty
  if (!Array.isArray(plan.clips) || plan.clips.length === 0) {
    throw new Error('Plan must have a non-empty clips array');
  }

  // Validate each scene has at least one event
  for (let i = 0; i < plan.clips.length; i++) {
    const scene = plan.clips[i];
    if (!Array.isArray(scene.events) || scene.events.length === 0) {
      throw new Error(`Scene at index ${i} must have a non-empty events array`);
    }
  }

  // Build a lookup keyed by "episodeIndex:ordinal" where ordinal is the
  // 0-based position of the clip WITHIN its episode group, in array order.
  // The consumer (drama-writer) looks up `${ep.episodeIndex}:${i}` with i =
  // the per-episode loop position. Keying by the LLM-emitted clipIndex broke
  // every lookup (→ all plan-driven state silently dropped) whenever the
  // model emitted 1-based or sparse clipIndex.
  plan.sceneMap = {};
  const perEpisodeCount = {};
  for (const scene of plan.clips) {
    if (scene.episodeIndex === undefined) continue;
    const ord = perEpisodeCount[scene.episodeIndex] ?? 0;
    perEpisodeCount[scene.episodeIndex] = ord + 1;
    plan.sceneMap[`${scene.episodeIndex}:${ord}`] = scene;
  }

  return plan;
}

// ─── State initializer ─────────────────────────────────────────────────────────

/**
 * Creates a StoryState populated from a parsed plan.
 * @param {object} plan - parsed plan from parsePlan
 * @returns {object} - StoryState
 */
export function initStateFromPlan(plan) {
  const state = createState();

  for (const char of (plan.characters || [])) {
    addCharacter(state, char);
  }

  for (const item of (plan.items || [])) {
    addItem(state, item);
  }

  for (const location of (plan.locations || [])) {
    addLocation(state, location);
  }

  for (const revelation of (plan.revelations || [])) {
    addRevelation(state, revelation);
  }

  return state;
}

// ─── Generate plan via Claude ──────────────────────────────────────────────────

/**
 * Calls Claude to generate a plan from an outline, then parses and returns it.
 * @param {object} outline
 * @param {object} options - { lang, genre, referenceCharacter, referenceEvent }
 * @returns {Promise<object>}
 */
export async function generatePlan(outline, options = {}) {
  const lang = options.lang || 'cn';
  const genre = options.genre || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const bible = options.bible || null;
  const chapters = options.chapters || null;
  const fidelity = options.fidelity || null;
  const aggregateChapterRange = options.aggregateChapterRange || null;
  const mode = options.mode || 'default';
  const prompt = buildPlanPrompt(outline, lang, genre, referenceCharacter, referenceEvent, {
    bible, chapters, fidelity, aggregateChapterRange, mode,
  });
  const raw = await callLLM(prompt, 'plan');
  return parsePlan(raw);
}
