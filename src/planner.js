import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from './llm.js';
import {
  createState,
  addCharacter,
  addItem,
  addLocation,
  addRevelation,
} from './drama-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── JSON extraction helpers (same pattern as compressor.js / drama-writer.js) ────────

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

// ─── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Reads the plan prompt template for the given language and replaces {{outline}}
 * with the JSON-serialized outline.
 * @param {object} outline
 * @param {string} lang - 'en' or 'cn'
 * @returns {string}
 */
export function buildPlanPrompt(outline, lang = 'cn', genre = '', referenceCharacter = '', referenceEvent = '') {
  const templatePath = join(__dirname, '..', 'prompts', 'plan.md');
  let template = readFileSync(templatePath, 'utf8');
  if (genre) {
    const section = lang === 'cn'
      ? `\n\n## 题材要求\n\n这个故事是**${genre}**类型的小说。所有场景规划、角色行为、事件设计都必须符合此类型的特征。\n`
      : `\n\n## Novel Type Requirement\n\nThis story is a **${genre}** novel. All scene planning, character behavior, and event design must align with this genre/type.\n`;
    template += section;
  }
  if (referenceCharacter) {
    const section = lang === 'cn'
      ? `\n\n## 参考角色（必须使用）\n\n以下角色已预先定义并必须出现在本故事中。在 characters 数组中请以其姓名、身份、动机与背景填入一项，并确保其行为、情绪、弧光在所有 clips.events 中与以下描述一致。不得改名或替换。\n\n---\n${referenceCharacter}\n---\n`
      : `\n\n## Reference Character (REQUIRED)\n\nThe following character is predefined and MUST appear in this story. Include them in the characters array using their exact name, identity, motivations, and background, and ensure their behavior, emotions, and arc across all clips.events remain consistent with the description below. Do NOT rename or replace them.\n\n---\n${referenceCharacter}\n---\n`;
    template += section;
  }
  if (referenceEvent) {
    const section = lang === 'cn'
      ? `\n\n## 参考事件（必须使用）\n\n以下事件已预先定义并必须在本故事中发生。请将其编入 clips.events 中具体的场景节点，确保相关角色的情绪、revelations（揭示）与后续情节弧线都与该事件及其后果保持一致。不要淡化或改写事件的核心事实。\n\n---\n${referenceEvent}\n---\n`
      : `\n\n## Reference Event (REQUIRED)\n\nThe following event is predefined and MUST occur in this story. Schedule it into specific clips.events entries, and ensure the emotional states, revelations, and subsequent plot arcs of affected characters remain consistent with this event and its aftermath. Do NOT sanitize or rewrite its core facts.\n\n---\n${referenceEvent}\n---\n`;
    template += section;
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
  const cleaned = cleanRaw(raw);

  let plan;

  // Attempt 1: direct parse
  try { plan = JSON.parse(cleaned); } catch { plan = null; }

  // Attempt 2: extract JSON object from surrounding text
  if (!plan) {
    plan = extractJsonObject(cleaned);
  }

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

  // Build a lookup map keyed by "episodeIndex:clipIndex" for branching tree access
  plan.sceneMap = {};
  for (const scene of plan.clips) {
    if (scene.episodeIndex !== undefined && scene.clipIndex !== undefined) {
      plan.sceneMap[`${scene.episodeIndex}:${scene.clipIndex}`] = scene;
    }
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
  const prompt = buildPlanPrompt(outline, lang, genre, referenceCharacter, referenceEvent);
  const raw = await callLLM(prompt, 'plan');
  return parsePlan(raw);
}
