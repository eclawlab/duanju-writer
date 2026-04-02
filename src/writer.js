import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from './llm.js';
import { getStyle, listStyles } from './styles.js';
import { generatePlan, initStateFromPlan } from './planner.js';
import { compressScenes, buildHistoryContext } from './compressor.js';
import { updateCharacter, updateItem, getAvailableRevelations, markRevealed, toPromptContext, validate } from './story-state.js';
import { checkConsistency, rewriteForConsistency, updateMotifTracker } from './consistency.js';
import { createStore } from './vectorstore.js';
import { queryKnowledge } from './knowledge.js';
import { generateSnowflake } from './snowflake.js';
import { updateGlobalSummary, formatGlobalSummary } from './compressor.js';
import { addPlotArc, addForeshadowing, reinforceForeshadowing, resolveForeshadowing, addRelationship, setCharacterArc, getOpenPlotArcs, getUnresolvedForeshadowing } from './story-state.js';
import { getSceneTypeRules } from './scene-types.js';
import { needsEnrichment, enrichScene } from './enrichment.js';
import { loadConfig } from './config.js';

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

  const fixed = await callLLM(prompt, 'repair');
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
  const raw = await callLLM(prompt, 'outline');
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
    if (narrativeContext.suspenseDensity) {
      template += `\n\n## Suspense\n\nSuspense density: ${narrativeContext.suspenseDensity}. Twist strength: ${narrativeContext.twistStrength || 1}/5.\n`;
    }
    if (narrativeContext.globalSummary) {
      template += `\n\n## Global Story Summary\n\n${narrativeContext.globalSummary}\n`;
    }
    if (narrativeContext.knowledgeContext) {
      template += `\n\n## Reference Knowledge\n\nRelevant context from prior scenes and reference materials:\n${narrativeContext.knowledgeContext}\n`;
    }
    if (narrativeContext.consistencyNotes && narrativeContext.consistencyNotes.length > 0) {
      template += `\n\n## Writing Notes\n\nAvoid these patterns:\n${narrativeContext.consistencyNotes.map(n => '- ' + n).join('\n')}\n`;
    }
    if (narrativeContext.sceneTypeRules) {
      template += `\n\n## Scene Type Guidelines\n\n${narrativeContext.sceneTypeRules}\n`;
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
  const raw = await callLLM(prompt, 'scene');
  return await parseScene(raw);
}

// ─── Fallback scene generation ──────────────────────────────────────────────

export function buildRetryScenePrompt(scenePlan, lang = 'en') {
  const summary = scenePlan.summary || 'A scene in the story';
  const sceneType = scenePlan.sceneType || 'NARRATIVE';

  if (lang === 'cn') {
    return [
      '请根据以下场景描述撰写一个场景。只返回有效的JSON对象，不要其他内容。',
      '',
      `场景描述：${summary}`,
      `场景类型：${sceneType}`,
      '',
      '返回格式：',
      '{"content": "[narrator]\\n你的场景文本...", "sceneType": "' + sceneType + '", "choices": [], "conclusion": null}',
      '',
      '重要：content字段中的换行用\\n表示，双引号用\\"转义。只返回JSON。',
    ].join('\n');
  }

  return [
    'Write a scene based on the following description. Return ONLY a valid JSON object, nothing else.',
    '',
    `Scene description: ${summary}`,
    `Scene type: ${sceneType}`,
    '',
    'Return format:',
    '{"content": "[narrator]\\nYour scene text here...", "sceneType": "' + sceneType + '", "choices": [], "conclusion": null}',
    '',
    'IMPORTANT: Newlines in content must be \\n, double quotes must be \\". Return only JSON.',
  ].join('\n');
}

export function buildFallbackScene(scenePlan) {
  const summary = scenePlan.summary || 'The story continues.';
  const sceneType = scenePlan.sceneType || 'NARRATIVE';
  const scene = {
    content: `[narrator]\n${summary}`,
    sceneType,
    choices: [],
    conclusion: null,
  };
  if (scenePlan.isConclusion) {
    scene.conclusion = {
      title: 'End',
      overview: summary,
      type: scenePlan.conclusionType || 'EPISODE_END',
      ending: scenePlan.ending || 'GOOD',
    };
  }
  if (scenePlan.hasChoices && scenePlan.choiceTexts) {
    scene.choices = scenePlan.choiceTexts.map((text, idx) => ({
      text,
      nextSceneIndex: idx + 1,
    }));
  }
  return scene;
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
  const raw = await callLLM(prompt, 'style');
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
  const { targetWordsPerScene } = loadConfig();

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

  // Step 0: Snowflake architecture (optional, enriches outline)
  let snowflake = null;
  try {
    log('Building story architecture (Snowflake method)...');
    snowflake = await generateSnowflake(materials, { lang, log });
    if (options.onSnowflake) options.onSnowflake(snowflake);
    log(`Architecture: seed defined, ${snowflake.characters.length} characters designed`);
  } catch (err) {
    log(`[snowflake failed] ${err.message} — continuing with standard outline`);
  }

  // Step 1: Generate outline (enriched with snowflake if available)
  log('Generating story outline...');
  const enrichedMaterials = snowflake
    ? { ...materials, snowflake }
    : materials;
  const outline = await generateOutline(enrichedMaterials, { lang, style });
  if (options.onOutline) options.onOutline(outline);
  log(`Outline: "${outline.title}" — ${outline.episodes[0].scenePlan.length} scenes planned`);

  // Step 2: Generate plan (planning agent) — optional, continues without if it fails
  let plan = { scenes: [], characters: [], items: [], locations: [], revelations: [] };
  try {
    log('Planning scene details, events, and revelations...');
    plan = await generatePlan(outline, { lang });
    if (options.onPlan) options.onPlan(plan);
    log(`Plan: ${plan.scenes.length} scenes planned, ${(plan.revelations || []).length} revelations scheduled`);
  } catch (planErr) {
    log(`[planning failed] ${planErr.message} — continuing without plan`);
  }

  // Step 3: Initialize story state from plan
  const state = initStateFromPlan(plan);

  // Populate character arcs from snowflake
  if (snowflake && snowflake.characters) {
    for (const sc of snowflake.characters) {
      if (sc.arc && state.characters[sc.name]) {
        try { setCharacterArc(state, sc.name, sc.arc); } catch {}
      }
    }
  }

  // Populate plot arcs from plan
  for (const arc of (plan.plotArcs || [])) {
    try { addPlotArc(state, arc); } catch {}
  }

  // Populate foreshadowing from plan
  for (const f of (plan.foreshadowing || [])) {
    try { addForeshadowing(state, f); } catch {}
  }

  // Populate relationships from plan
  for (const rel of (plan.relationships || [])) {
    try { addRelationship(state, rel.char1, rel.char2, rel.type, rel.description); } catch {}
  }

  const motifTracker = {};
  const compressedHistory = [];
  let globalSummary = '';

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

  let globalSceneIndex = 0;

  for (const ep of outline.episodes) {
    const episode = { title: ep.title, scenes: [] };
    const totalScenes = ep.scenePlan.length;

    for (let i = 0; i < totalScenes; i++) {
      const plan_scene = ep.scenePlan[i];
      log(`Writing scene ${globalSceneIndex + 1}: ${plan_scene.summary.slice(0, 60)}...`);

      // Build narrative context
      const history = buildHistoryContext(compressedHistory);
      const revelations = getAvailableRevelations(state, globalSceneIndex);
      const stateContext = toPromptContext(state);

      // Validate state and log warnings
      const stateWarnings = validate(state);
      for (const warning of stateWarnings) {
        log(`[state warning] ${warning}`);
      }

      // Get plan scene data for events/pacing (flat array across all episodes)
      const planScene = plan.scenes[globalSceneIndex] || {};

      // Query vector store for relevant prior context
      let knowledgeContext = '';
      if (options.vectorStore) {
        try {
          const query = plan_scene.summary + ' ' + (planScene.events || []).join(' ');
          const results = await queryKnowledge(options.vectorStore, query, 3, globalSceneIndex);
          if (results.length > 0) {
            knowledgeContext = results.map(r => r.text).join('\n\n');
          }
        } catch (err) {
          log(`[knowledge retrieval failed] ${err.message}`);
        }
      }

      // Generate scene with narrative context (with retry and fallback)
      const sceneTypeRules = getSceneTypeRules(plan_scene.sceneType || 'NARRATIVE', lang);
      let scene;
      try {
        scene = await generateScene(outline, i, plan_scene, totalScenes, {
          lang,
          style,
          narrativeContext: {
            history,
            stateContext,
            revelations,
            events: planScene.events,
            pacing: planScene.pacing,
            knowledgeContext,
            suspenseDensity: planScene.suspenseDensity,
            twistStrength: planScene.twistStrength,
            globalSummary,
            sceneTypeRules,
          },
        });
      } catch (firstErr) {
        log(`[scene ${globalSceneIndex + 1} failed] ${firstErr.message} — retrying with simplified prompt...`);
        try {
          const retryPrompt = buildRetryScenePrompt(plan_scene, lang);
          const retryRaw = await callLLM(retryPrompt, 'scene');
          scene = await parseScene(retryRaw);
        } catch (retryErr) {
          log(`[scene ${globalSceneIndex + 1} retry failed] ${retryErr.message} — using fallback scene`);
          scene = buildFallbackScene(plan_scene);
        }
      }

      // Index scene in vector store for future retrieval
      if (options.vectorStore) {
        try {
          options.vectorStore.add(
            `scene_${globalSceneIndex}`,
            scene.content,
            { sceneIndex: globalSceneIndex, episodeTitle: ep.title }
          );
        } catch (err) {
          log(`[scene indexing failed] ${err.message}`);
        }
      }

      // Check and fix consistency issues
      const consistencyResult = checkConsistency(scene.content, motifTracker, globalSceneIndex);
      if (consistencyResult.issues.length > 0) {
        log(`Fixing ${consistencyResult.issues.length} consistency issue(s) in scene ${globalSceneIndex + 1}...`);
        try {
          scene.content = await rewriteForConsistency(scene.content, consistencyResult.issues, lang);
        } catch (err) {
          log(`[consistency rewrite failed] ${err.message}`);
        }
      }

      // Enrich scene if below word count target
      if (needsEnrichment(scene.content, targetWordsPerScene)) {
        log(`Scene ${globalSceneIndex + 1} below word target (${targetWordsPerScene}) — enriching...`);
        try {
          scene.content = await enrichScene(scene.content, targetWordsPerScene, lang);
        } catch (err) {
          log(`[enrichment failed] ${err.message}`);
        }
      }

      // Update global narrative summary
      try {
        globalSummary = await updateGlobalSummary(globalSummary, scene.content, lang);
      } catch (err) {
        log(`[global summary update failed] ${err.message}`);
      }

      // Update motif tracker
      updateMotifTracker(motifTracker, scene.content, globalSceneIndex);

      // Apply character changes from plan
      for (const cc of (planScene.characterChanges || [])) {
        try {
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
          if (Object.keys(updates).length > 0) {
            updateCharacter(state, cc.name, updates);
          }
        } catch (err) {
          log(`[state update skipped] ${err.message}`);
        }
      }
      // Apply item changes from plan
      for (const ic of (planScene.itemChanges || [])) {
        try {
          if (ic.name && state.items[ic.name]) {
            const updates = {};
            if (ic.status) updates.status = ic.status;
            if (ic.holder !== undefined) updates.holder = ic.holder;
            if (ic.location !== undefined) updates.location = ic.location;
            if (Object.keys(updates).length > 0) {
              updateItem(state, ic.name, updates);
            }
          }
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

      // Handle foreshadowing operations from plan
      for (const fId of (planScene.reinforceForeshadowing || [])) {
        try { reinforceForeshadowing(state, fId, globalSceneIndex); } catch {}
      }
      for (const fId of (planScene.resolveForeshadowing || [])) {
        try { resolveForeshadowing(state, fId, globalSceneIndex); } catch {}
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
      globalSceneIndex++;
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
