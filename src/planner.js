import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude } from './claude.js';
import {
  createState,
  addCharacter,
  addItem,
  addLocation,
  addRevelation,
} from './story-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── JSON extraction helpers (same pattern as compressor.js / writer.js) ────────

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
export function buildPlanPrompt(outline, lang = 'en') {
  const templateFile = lang === 'cn' ? 'plan-cn.md' : 'plan.md';
  const templatePath = join(__dirname, '..', 'prompts', templateFile);
  const template = readFileSync(templatePath, 'utf8');
  return template.replace('{{outline}}', JSON.stringify(outline, null, 2));
}

// ─── Output parser ─────────────────────────────────────────────────────────────

/**
 * Strips code fences, parses JSON, and validates the plan structure.
 * Throws if scenes is missing/empty or any scene has no events.
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

  // Validate scenes array exists and is non-empty
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new Error('Plan must have a non-empty scenes array');
  }

  // Validate each scene has at least one event
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    if (!Array.isArray(scene.events) || scene.events.length === 0) {
      throw new Error(`Scene at index ${i} must have a non-empty events array`);
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
 * @param {object} options - passed to callClaude
 * @returns {Promise<object>}
 */
export async function generatePlan(outline, options = {}) {
  const lang = options.lang || 'en';
  const prompt = buildPlanPrompt(outline, lang);
  const raw = await callClaude(prompt, options);
  return parsePlan(raw);
}
