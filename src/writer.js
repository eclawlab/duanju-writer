import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude } from './claude.js';
import { getStyle, listStyles } from './styles.js';
import { generatePlan, initStateFromPlan } from './planner.js';
import { compressScenes, buildHistoryContext } from './compressor.js';
import { updateCharacter, updateItem, getAvailableRevelations, markRevealed, toPromptContext, validate } from './story-state.js';
import { checkConsistency, rewriteForConsistency, updateMotifTracker } from './consistency.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OUTLINE_PATH = join(__dirname, '..', 'prompts', 'outline.md');
const OUTLINE_PATH_CN = join(__dirname, '..', 'prompts', 'outline-cn.md');
const SCENES_PATH = join(__dirname, '..', 'prompts', 'scenes.md');
const SCENES_PATH_CN = join(__dirname, '..', 'prompts', 'scenes-cn.md');

// ─── JSON extraction and repair ───────────────────────────────────────────────

function cleanRaw(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

function extractJsonObject(text) {
  // Find the first { and last } to extract JSON from surrounding text
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function tryParseJson(raw) {
  const cleaned = cleanRaw(raw);

  // Attempt 1: direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Attempt 2: extract JSON object from mixed output
  const extracted = extractJsonObject(cleaned);
  if (extracted) return extracted;

  return null;
}

async function repairJson(broken, label) {
  const prompt = [
    'The following text was supposed to be valid JSON but has syntax errors.',
    'Common issues: unescaped quotes inside strings, missing commas, trailing commas, unescaped newlines in strings.',
    'Fix ALL issues and return ONLY the corrected valid JSON object. No explanation, no markdown fences.',
    '',
    broken,
  ].join('\n');

  const fixed = await callClaude(prompt);
  const result = tryParseJson(fixed);
  if (result) return result;

  // Last resort: try extracting from the raw repair output
  const extracted = extractJsonObject(fixed);
  if (extracted) return extracted;

  throw new Error(`Failed to parse ${label} JSON even after LLM repair`);
}

async function parseJsonWithRepair(raw, label) {
  const result = tryParseJson(raw);
  if (result) return result;
  return await repairJson(cleanRaw(raw), label);
}

// ─── Step 1: Generate outline ─────────────────────────────────────────────────

export function buildOutlinePrompt(materials, lang = 'en', styleKey) {
  const templateFile = lang === 'cn' ? OUTLINE_PATH_CN : OUTLINE_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const style = getStyle(styleKey);
  if (style) {
    template += `\n\n## Writing Style\n\n${style.outline}\n`;
  }
  return template.replace('{{materials}}', JSON.stringify(materials, null, 2));
}

export async function parseOutline(raw) {
  const data = await parseJsonWithRepair(raw, 'outline');

  if (!data.title) throw new Error('Missing required field: title');
  if (!data.synopsis) throw new Error('Missing required field: synopsis');
  if (!data.episodes || data.episodes.length === 0) {
    throw new Error('Outline must have at least 1 episode');
  }
  for (const ep of data.episodes) {
    if (!ep.scenePlan || ep.scenePlan.length === 0) {
      throw new Error(`Episode "${ep.title}" must have at least 1 scene in scenePlan`);
    }
    for (let i = 0; i < ep.scenePlan.length; i++) {
      if (!ep.scenePlan[i].summary) {
        throw new Error(`Episode "${ep.title}" scene ${i} missing summary`);
      }
    }
  }

  return data;
}

export async function generateOutline(materials, options = {}) {
  const lang = options.lang || 'en';
  const style = options.style;
  const prompt = buildOutlinePrompt(materials, lang, style);
  const raw = await callClaude(prompt);
  return await parseOutline(raw);
}

// ─── Step 2: Generate scenes one at a time ────────────────────────────────────

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
      template += `\n\n## Scene Beats\n\nThis scene should cover these beats:\n${narrativeContext.events.map(e => '- ' + e).join('\n')}\n`;
    }
    if (narrativeContext.pacing) {
      template += `\n\n## Pacing\n\nThis scene's pacing should be: ${narrativeContext.pacing}\n`;
    }
    if (narrativeContext.consistencyNotes && narrativeContext.consistencyNotes.length > 0) {
      template += `\n\n## Writing Notes\n\nAvoid these patterns:\n${narrativeContext.consistencyNotes.map(n => '- ' + n).join('\n')}\n`;
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

export async function parseScene(raw) {
  const data = await parseJsonWithRepair(raw, 'scene');

  if (!data.content) throw new Error('Scene missing content');
  return data;
}

export async function generateScene(outline, sceneIndex, scenePlan, totalScenes, options = {}) {
  const lang = options.lang || 'en';
  const style = options.style;
  const narrativeContext = options.narrativeContext;
  const prompt = buildScenePrompt(outline, sceneIndex, scenePlan, totalScenes, lang, style, narrativeContext);
  const raw = await callClaude(prompt);
  return await parseScene(raw);
}

// ─── Style selection ─────────────────────────────────────────────────────────

export function buildPickStylePrompt(materials) {
  const styles = listStyles();
  const styleList = styles.map(s => {
    const def = getStyle(s.key);
    return `- ${s.key}: ${s.name}\n  ${def.outline.split('\n')[1] || ''}`;
  }).join('\n');

  return [
    'You are a literary style advisor. Given the story materials below, pick the single best-fit writing style from the available options.',
    '',
    '## Available Styles',
    '',
    styleList,
    '',
    '## Story Materials',
    '',
    JSON.stringify(materials, null, 2),
    '',
    '## Instructions',
    '',
    'Consider the genres, themes, setting, and tone of the materials. Pick the style whose strengths best complement this story.',
    'Return ONLY the style key as a single word (e.g. "moyan"). No explanation, no quotes, no punctuation.',
  ].join('\n');
}

export async function pickStyle(materials) {
  const prompt = buildPickStylePrompt(materials);
  const raw = await callClaude(prompt);
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  // Validate the key — fall back to null (default) if unrecognized
  try {
    getStyle(key);
    return key;
  } catch {
    return null;
  }
}

// ─── Full pipeline: outline → scenes ──────────────────────────────────────────

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

  // Step 4: Generate each scene with narrative intelligence
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
      const plan_scene = ep.scenePlan[i];
      log(`Writing scene ${i + 1}/${totalScenes}: ${plan_scene.summary.slice(0, 60)}...`);

      // Build narrative context
      const history = buildHistoryContext(compressedHistory);
      const revelations = getAvailableRevelations(state, i);
      const stateContext = toPromptContext(state);

      // Validate state and log warnings
      const stateWarnings = validate(state);
      for (const warning of stateWarnings) {
        log(`[state warning] ${warning}`);
      }

      // Get plan scene data for events/pacing
      const planScene = plan.scenes[i] || {};

      // Generate scene with narrative context
      const scene = await generateScene(outline, i, plan_scene, totalScenes, {
        lang,
        style,
        narrativeContext: {
          history,
          stateContext,
          revelations,
          events: planScene.events,
          pacing: planScene.pacing,
        },
      });

      // Check and fix consistency issues
      const consistencyResult = checkConsistency(scene.content, motifTracker, i);
      if (consistencyResult.issues.length > 0) {
        log(`Fixing ${consistencyResult.issues.length} consistency issue(s) in scene ${i + 1}...`);
        try {
          scene.content = await rewriteForConsistency(scene.content, consistencyResult.issues, lang);
        } catch (err) {
          log(`[consistency rewrite failed] ${err.message}`);
        }
      }

      // Update motif tracker
      updateMotifTracker(motifTracker, scene.content, i);

      // Apply character and item changes from plan
      for (const [charName, changes] of Object.entries(planScene.characterChanges || {})) {
        try {
          updateCharacter(state, charName, changes);
        } catch (err) {
          log(`[state update skipped] ${err.message}`);
        }
      }
      for (const [itemName, changes] of Object.entries(planScene.itemChanges || {})) {
        try {
          updateItem(state, itemName, changes);
        } catch (err) {
          log(`[state update skipped] ${err.message}`);
        }
      }

      // Mark revelations as revealed
      for (const revId of (planScene.revealIds || [])) {
        try {
          markRevealed(state, revId);
        } catch (err) {
          log(`[revelation skipped] ${err.message}`);
        }
      }

      // Compress scene into history
      try {
        const compressed = await compressScenes([scene], lang);
        compressedHistory.push(compressed);
      } catch (err) {
        log(`[compression failed] ${err.message}`);
        compressedHistory.push({ summary: plan_scene.summary, characterActions: [], plotProgress: [], emotionalArc: '' });
      }

      // Notify caller of state update
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
