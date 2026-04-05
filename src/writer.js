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
import { updateGlobalSummary } from './compressor.js';
import { addPlotArc, addForeshadowing, reinforceForeshadowing, resolveForeshadowing, addRelationship, setCharacterArc } from './story-state.js';
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

export function buildOutlinePrompt(materials, lang = 'en', styleKey, novelType = '') {
  const templateFile = lang === 'cn' ? OUTLINE_PATH_CN : OUTLINE_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const style = getStyle(styleKey);
  if (style) {
    template += `\n\n## Writing Style\n\n${style.outline}\n`;
  }
  if (novelType) {
    const section = lang === 'cn'
      ? `\n\n## 小说类型要求\n\n这个故事必须是**${novelType}**类型的小说。所有情节、角色、世界观和叙事风格都必须符合此类型的特征和读者期望。\n`
      : `\n\n## Novel Type Requirement\n\nThis story MUST be a **${novelType}** novel. All plot elements, characters, world-building, and narrative style must align with this genre/type and its reader expectations.\n`;
    template += section;
  }
  return template.replace('{{materials}}', () => JSON.stringify(materials, null, 2));
}

export async function parseOutline(raw) {
  const data = await parseJsonWithRepair(raw, 'outline');

  if (!data.title) throw new Error('Missing required field: title');
  if (!data.synopsis) throw new Error('Missing required field: synopsis');
  if (!data.episodes || data.episodes.length === 0) {
    throw new Error('Outline must have at least 1 episode');
  }

  // Build index of valid episodeIndex values and check for duplicates
  const validIndices = new Set();
  for (const ep of data.episodes) {
    if (ep.episodeIndex === undefined) {
      throw new Error(`Episode "${ep.title}" missing episodeIndex`);
    }
    if (validIndices.has(ep.episodeIndex)) {
      throw new Error(`Duplicate episodeIndex ${ep.episodeIndex} found on episode "${ep.title}"`);
    }
    validIndices.add(ep.episodeIndex);
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
    // Validate episodeChoices references
    if (!ep.isEnding) {
      if (!ep.episodeChoices || ep.episodeChoices.length < 3) {
        throw new Error(`Non-ending episode "${ep.title}" must have at least 3 episodeChoices (got ${ep.episodeChoices?.length || 0})`);
      }
      if (ep.episodeChoices.length > 5) {
        throw new Error(`Non-ending episode "${ep.title}" must have at most 5 episodeChoices (got ${ep.episodeChoices.length})`);
      }
      for (const choice of ep.episodeChoices) {
        if (!choice.text) throw new Error(`Episode "${ep.title}" has a choice missing text`);
        if (choice.nextEpisodeIndex === undefined || !validIndices.has(choice.nextEpisodeIndex)) {
          throw new Error(`Episode "${ep.title}" choice "${choice.text}" references invalid episodeIndex ${choice.nextEpisodeIndex}`);
        }
      }
    }
  }

  // Validate no cycles in the episode graph
  const adjacency = {};
  for (const ep of data.episodes) {
    adjacency[ep.episodeIndex] = (ep.episodeChoices || []).map(c => c.nextEpisodeIndex);
  }
  const visited = new Set();
  const inStack = new Set();
  function hasCycle(node) {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const next of (adjacency[node] || [])) {
      if (hasCycle(next)) return true;
    }
    inStack.delete(node);
    return false;
  }
  for (const ep of data.episodes) {
    if (hasCycle(ep.episodeIndex)) {
      throw new Error('Episode graph contains a cycle — episodeChoices must form a tree (no loops)');
    }
  }

  return data;
}

export async function generateOutline(materials, options = {}) {
  const lang = options.lang || 'en';
  const style = options.style;
  const novelType = options.novelType || '';
  const prompt = buildOutlinePrompt(materials, lang, style, novelType);
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

  template = template.replace('{{outline}}', () => JSON.stringify(outlineSummary, null, 2));
  template = template.replace('{{sceneIndex}}', () => String(sceneIndex + 1));
  template = template.replace('{{totalScenes}}', () => String(totalScenes));
  template = template.replace('{{sceneSummary}}', () => scenePlan.summary);
  template = template.replace('{{sceneType}}', () => scenePlan.sceneType || 'NARRATIVE');

  // Handle conditional sections
  if (scenePlan.hasChoices && scenePlan.choiceTexts) {
    template = template.replace('{{#hasChoices}}', '').replace('{{/hasChoices}}', '');
    template = template.replace('{{choiceTexts}}', () => scenePlan.choiceTexts.join(', '));
  } else {
    template = template.replace(/\{\{#hasChoices\}\}.*?\{\{\/hasChoices\}\}/gs, '');
  }

  if (scenePlan.isConclusion) {
    template = template.replace('{{#isConclusion}}', '').replace('{{/isConclusion}}', '');
    template = template.replace('{{conclusionType}}', () => scenePlan.conclusionType || 'EPISODE_END');
    template = template.replace('{{ending}}', () => scenePlan.ending || 'GOOD');
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
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
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
  const novelType = options.novelType || '';
  let style = options.style;
  const log = options.log || (() => {});
  const wlog = options.wlog || (() => {});
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
  let snowflake = options.savedSnowflake || null;
  if (!snowflake) {
    try {
      log('Building story architecture (Snowflake method)...');
      snowflake = await generateSnowflake(materials, { lang, log });
      if (options.onSnowflake) options.onSnowflake(snowflake);
      log(`Architecture: seed defined, ${snowflake.characters.length} characters designed`);
    } catch (err) {
      log(`[snowflake failed] ${err.message} — continuing with standard outline`);
    }
  } else {
    log('Resuming — snowflake architecture already generated');
  }

  // Step 1: Generate outline (enriched with snowflake if available)
  let outline = options.savedOutline || null;
  if (!outline) {
    log('Generating story outline...');
    const enrichedMaterials = snowflake
      ? { ...materials, snowflake }
      : materials;
    outline = await generateOutline(enrichedMaterials, { lang, style, novelType });
    if (options.onOutline) options.onOutline(outline);
  } else {
    log('Resuming — outline already generated');
  }
  const totalEpisodes = outline.episodes.length;
  const totalScenePlanned = outline.episodes.reduce((sum, ep) => sum + ep.scenePlan.length, 0);
  const endingCount = outline.episodes.filter(ep => ep.isEnding).length;
  log(`Outline: "${outline.title}" — ${totalEpisodes} episodes (${endingCount} endings), ${totalScenePlanned} scenes total`);

  // Step 2: Generate plan (planning agent) — optional, continues without if it fails
  let plan = options.savedPlan || null;
  if (!plan) {
    plan = { scenes: [], characters: [], items: [], locations: [], revelations: [] };
    try {
      log('Planning scene details, events, and revelations...');
      plan = await generatePlan(outline, { lang });
      if (options.onPlan) options.onPlan(plan);
      log(`Plan: ${plan.scenes.length} scenes planned, ${(plan.revelations || []).length} revelations scheduled`);
    } catch (planErr) {
      log(`[planning failed] ${planErr.message} — continuing without plan`);
    }
  } else {
    log('Resuming — plan already generated');
  }

  // Step 4: Generate each episode's scenes with narrative intelligence
  // Episodes form a branching tree — each branch gets its own narrative context
  const story = {
    title: outline.title,
    synopsis: outline.synopsis,
    fandom: outline.fandom || null,
    genres: outline.genres || [],
    tags: outline.tags || [],
    characterQuestions: outline.characterQuestions || [],
    episodes: [],
  };

  // Build parent map: childEpisodeIndex → parentEpisodeIndex
  // This lets us reconstruct the ancestor path for each episode's narrative context
  const parentMap = {};
  for (const ep of outline.episodes) {
    if (ep.episodeChoices) {
      for (const choice of ep.episodeChoices) {
        // Only set parent if not already set (first parent wins for shared episodes)
        if (parentMap[choice.nextEpisodeIndex] === undefined) {
          parentMap[choice.nextEpisodeIndex] = ep.episodeIndex;
        }
      }
    }
  }

  // Get ancestor path from root to a given episode (inclusive)
  function getAncestorPath(episodeIndex) {
    const path = [episodeIndex];
    const seen = new Set([episodeIndex]);
    let current = episodeIndex;
    while (parentMap[current] !== undefined) {
      current = parentMap[current];
      if (seen.has(current)) break; // safety: prevent infinite loop on cycles
      seen.add(current);
      path.unshift(current);
    }
    return path;
  }

  // Per-episode context snapshots (saved after each episode is generated)
  // Keyed by episodeIndex
  const episodeContexts = {};

  // Sort episodes by episodeIndex for deterministic processing
  const sortedEpisodes = [...outline.episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);

  let globalSceneIndex = 0;

  // Restore progress from a previous interrupted run
  const progress = options.progress;
  const completedEpisodeIndices = new Set();
  if (progress) {
    // Restore completed episodes
    for (const ep of (progress.episodes || [])) {
      story.episodes.push(ep);
      completedEpisodeIndices.add(ep.episodeIndex);
    }
    // Restore episode contexts for branch narrative continuity
    for (const [key, ctx] of Object.entries(progress.episodeContexts || {})) {
      episodeContexts[Number(key)] = ctx;
    }
    // Restore global scene index
    globalSceneIndex = progress.globalSceneIndex || 0;
    log(`Resuming writing — ${completedEpisodeIndices.size} episode(s) already completed, starting from scene index ${globalSceneIndex}`);
    wlog('writing_resumed_partial', { completedEpisodes: [...completedEpisodeIndices], globalSceneIndex });
  }

  for (const ep of sortedEpisodes) {
    // Skip episodes completed in a previous run
    if (completedEpisodeIndices.has(ep.episodeIndex)) {
      globalSceneIndex += ep.scenePlan.length;
      continue;
    }
    const episode = { title: ep.title, episodeIndex: ep.episodeIndex, isEnding: !!ep.isEnding, ending: ep.ending || null, scenes: [], episodeChoices: ep.episodeChoices || [] };
    const totalScenes = ep.scenePlan.length;

    log(`Writing episode ${ep.episodeIndex}: "${ep.title}" (${totalScenes} scenes, ${ep.isEnding ? 'ending' : ep.episodeChoices?.length + ' choices'})...`);
    wlog('episode_start', { episodeIndex: ep.episodeIndex, title: ep.title, scenes: totalScenes, isEnding: !!ep.isEnding, choices: ep.isEnding ? 0 : ep.episodeChoices?.length || 0 });

    // Reconstruct branch-local narrative context from ancestor path
    const ancestorPath = getAncestorPath(ep.episodeIndex);
    const branchHistory = [];
    let branchSummary = '';
    const branchMotifTracker = {};

    // Rebuild state from initial plan state (fresh copy per branch)
    const branchState = initStateFromPlan(plan);
    if (snowflake && snowflake.characters) {
      for (const sc of snowflake.characters) {
        if (sc.arc && branchState.characters[sc.name]) {
          try { setCharacterArc(branchState, sc.name, sc.arc); } catch {}
        }
      }
    }
    for (const arc of (plan.plotArcs || [])) {
      try { addPlotArc(branchState, arc); } catch {}
    }
    for (const f of (plan.foreshadowing || [])) {
      try { addForeshadowing(branchState, f); } catch {}
    }
    for (const rel of (plan.relationships || [])) {
      try { addRelationship(branchState, rel.char1, rel.char2, rel.type, rel.description); } catch {}
    }

    // Apply ancestor episodes' context snapshots (everything except current episode)
    for (const ancestorIdx of ancestorPath.slice(0, -1)) {
      const ctx = episodeContexts[ancestorIdx];
      if (ctx) {
        branchHistory.push(...ctx.compressedHistory);
        branchSummary = ctx.globalSummary;
        // Merge motif tracker
        for (const [key, val] of Object.entries(ctx.motifTracker)) {
          branchMotifTracker[key] = val;
        }
        // Apply state changes from ancestor
        for (const [name, char] of Object.entries(ctx.stateChanges.characters)) {
          try { updateCharacter(branchState, name, char); } catch {}
        }
        for (const [name, item] of Object.entries(ctx.stateChanges.items)) {
          try { updateItem(branchState, name, item); } catch {}
        }
        for (const revId of ctx.stateChanges.revealedIds) {
          try { markRevealed(branchState, revId); } catch {}
        }
        for (const fId of ctx.stateChanges.reinforcedForeshadowing) {
          try { reinforceForeshadowing(branchState, fId, 0); } catch {}
        }
        for (const fId of ctx.stateChanges.resolvedForeshadowing) {
          try { resolveForeshadowing(branchState, fId, 0); } catch {}
        }
      }
    }

    // Compute branch-local scene count: total scenes from ancestor episodes
    // This represents how many scenes the reader has seen before this episode on this path
    let branchSceneCount = 0;
    for (const ancestorIdx of ancestorPath.slice(0, -1)) {
      const ancestorEp = sortedEpisodes.find(e => e.episodeIndex === ancestorIdx);
      if (ancestorEp) branchSceneCount += ancestorEp.scenePlan.length;
    }

    // Track this episode's own state changes (to save in snapshot)
    const episodeCharChanges = {};
    const episodeItemChanges = {};
    const episodeRevealedIds = [];
    const episodeReinforcedForeshadowing = [];
    const episodeResolvedForeshadowing = [];
    const episodeCompressedHistory = [];
    let episodeSummary = branchSummary;
    const episodeMotifTracker = { ...branchMotifTracker };

    for (let i = 0; i < totalScenes; i++) {
      const plan_scene = ep.scenePlan[i];
      log(`  Scene ${i + 1}/${totalScenes}: ${plan_scene.summary.slice(0, 60)}...`);

      // Build narrative context from branch-local state
      // Use branch-local scene position for revelation scheduling (not flat globalSceneIndex)
      const branchLocalSceneIndex = branchSceneCount + i;
      const history = buildHistoryContext([...branchHistory, ...episodeCompressedHistory]);
      const revelations = getAvailableRevelations(branchState, branchLocalSceneIndex);
      const stateContext = toPromptContext(branchState);

      // Validate state and log warnings
      const stateWarnings = validate(branchState);
      for (const warning of stateWarnings) {
        log(`[state warning] ${warning}`);
      }

      // Get plan scene data for events/pacing using composite key (episodeIndex:sceneIndex)
      const planScene = (plan.sceneMap && plan.sceneMap[`${ep.episodeIndex}:${i}`]) || plan.scenes[globalSceneIndex] || {};

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
            globalSummary: episodeSummary,
            sceneTypeRules,
          },
        });
      } catch (firstErr) {
        log(`[scene failed] ${firstErr.message} — retrying with simplified prompt...`);
        wlog('scene_retry', { episodeIndex: ep.episodeIndex, sceneIndex: i, error: firstErr.message });
        try {
          const retryPrompt = buildRetryScenePrompt(plan_scene, lang);
          const retryRaw = await callLLM(retryPrompt, 'scene');
          scene = await parseScene(retryRaw);
        } catch (retryErr) {
          log(`[scene retry failed] ${retryErr.message} — using fallback scene`);
          wlog('scene_fallback', { episodeIndex: ep.episodeIndex, sceneIndex: i, error: retryErr.message });
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

      // Check and fix consistency issues (use branch-local index for cooldown accuracy)
      const consistencyResult = checkConsistency(scene.content, episodeMotifTracker, branchLocalSceneIndex);
      if (consistencyResult.issues.length > 0) {
        log(`Fixing ${consistencyResult.issues.length} consistency issue(s)...`);
        try {
          scene.content = await rewriteForConsistency(scene.content, consistencyResult.issues, lang);
        } catch (err) {
          log(`[consistency rewrite failed] ${err.message}`);
        }
      }

      // Enrich scene if below word count target
      if (needsEnrichment(scene.content, targetWordsPerScene)) {
        log(`Scene below word target (${targetWordsPerScene}) — enriching...`);
        try {
          scene.content = await enrichScene(scene.content, targetWordsPerScene, lang);
        } catch (err) {
          log(`[enrichment failed] ${err.message}`);
        }
      }

      // Update branch-local narrative summary
      try {
        episodeSummary = await updateGlobalSummary(episodeSummary, scene.content, lang);
      } catch (err) {
        log(`[global summary update failed] ${err.message}`);
      }

      // Update motif tracker
      updateMotifTracker(episodeMotifTracker, scene.content, branchLocalSceneIndex);

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
            const char = branchState.characters[cc.name];
            if (char) updates.knowledge = [...(char.knowledge || []), ...cc.learns];
          }
          if (Object.keys(updates).length > 0) {
            updateCharacter(branchState, cc.name, updates);
            episodeCharChanges[cc.name] = { ...(episodeCharChanges[cc.name] || {}), ...updates };
          }
        } catch (err) {
          log(`[state update skipped] ${err.message}`);
        }
      }
      // Apply item changes from plan
      for (const ic of (planScene.itemChanges || [])) {
        try {
          if (ic.name && branchState.items[ic.name]) {
            const updates = {};
            if (ic.status) updates.status = ic.status;
            if (ic.holder !== undefined) updates.holder = ic.holder;
            if (ic.location !== undefined) updates.location = ic.location;
            if (Object.keys(updates).length > 0) {
              updateItem(branchState, ic.name, updates);
              episodeItemChanges[ic.name] = { ...(episodeItemChanges[ic.name] || {}), ...updates };
            }
          }
        } catch (err) {
          log(`[state update skipped] ${err.message}`);
        }
      }

      // Mark revelations as revealed
      for (const revId of (planScene.revealIds || [])) {
        try {
          markRevealed(branchState, revId);
          episodeRevealedIds.push(revId);
        } catch (err) {
          log(`[revelation skipped] ${err.message}`);
        }
      }

      // Handle foreshadowing operations from plan
      for (const fId of (planScene.reinforceForeshadowing || [])) {
        try { reinforceForeshadowing(branchState, fId, branchLocalSceneIndex); episodeReinforcedForeshadowing.push(fId); } catch {}
      }
      for (const fId of (planScene.resolveForeshadowing || [])) {
        try { resolveForeshadowing(branchState, fId, branchLocalSceneIndex); episodeResolvedForeshadowing.push(fId); } catch {}
      }

      // Compress scene into history
      try {
        const compressed = await compressScenes([scene], lang);
        episodeCompressedHistory.push(compressed);
      } catch (err) {
        log(`[compression failed] ${err.message}`);
        episodeCompressedHistory.push({ summary: plan_scene.summary, characterActions: [], plotProgress: [], emotionalArc: '' });
      }

      // Notify caller of state update
      if (options.onState) options.onState(branchState);

      const sceneWords = scene.content?.split(/\s+/).length || 0;
      const sceneChoices = (scene.choices?.length || 0);
      wlog('scene_done', {
        episodeIndex: ep.episodeIndex,
        sceneIndex: i,
        sceneOf: totalScenes,
        words: sceneWords,
        choices: sceneChoices,
        sceneType: scene.sceneType || plan_scene.sceneType || 'NARRATIVE',
        hasConclusion: !!scene.conclusion,
      });

      episode.scenes.push(scene);
      globalSceneIndex++;
    }

    // Save this episode's context snapshot for descendant episodes
    episodeContexts[ep.episodeIndex] = {
      compressedHistory: episodeCompressedHistory,
      globalSummary: episodeSummary,
      motifTracker: episodeMotifTracker,
      stateChanges: {
        characters: episodeCharChanges,
        items: episodeItemChanges,
        revealedIds: episodeRevealedIds,
        reinforcedForeshadowing: episodeReinforcedForeshadowing,
        resolvedForeshadowing: episodeResolvedForeshadowing,
      },
    };

    // For ending episodes, ensure the last scene has a conclusion
    if (ep.isEnding) {
      const lastScene = episode.scenes[episode.scenes.length - 1];
      if (!lastScene.conclusion) {
        log(`  Ending episode "${ep.title}" missing conclusion — injecting fallback`);
        lastScene.conclusion = {
          title: ep.title,
          overview: ep.scenePlan[ep.scenePlan.length - 1]?.summary || ep.title,
          type: 'STORY_END',
          ending: ep.ending || 'NEUTRAL',
        };
      }
    }

    // For non-ending episodes, attach episode-level choices to the last scene
    // These will be resolved to cross-episode scene references during upload
    if (!ep.isEnding && ep.episodeChoices && ep.episodeChoices.length > 0) {
      const lastScene = episode.scenes[episode.scenes.length - 1];
      // Append a [choice] block to the last scene content for audio playback
      const choiceLines = ep.episodeChoices.map(c => `- "${c.text}"`).join('\n');
      lastScene.content += `\n\n[choice]\n${choiceLines}`;
      // Store episode choices on the last scene for upload
      lastScene.episodeChoices = ep.episodeChoices;
    }

    story.episodes.push(episode);

    // Save progress after each completed episode for resume capability
    if (options.onEpisode) {
      options.onEpisode({
        episodes: story.episodes,
        episodeContexts: { ...episodeContexts },
        globalSceneIndex,
      });
    }
  }

  // Validate final story
  if (!story.episodes.length) throw new Error('Story must have at least 1 episode');
  for (const ep of story.episodes) {
    if (!ep.scenes.length) throw new Error(`Episode "${ep.title}" has no scenes`);
  }

  return story;
}
