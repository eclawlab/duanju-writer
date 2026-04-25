import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { callLLM } from './llm.js';
import { getStyle, getStyleSafe, listStyles } from './styles.js';
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
import { needsEnrichment, enrichScene, countWords } from './enrichment.js';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OUTLINE_PATH = join(__dirname, '..', 'prompts', 'outline.md');
const OUTLINE_PATH_CN = join(__dirname, '..', 'prompts', 'outline-cn.md');
const SCENES_PATH = join(__dirname, '..', 'prompts', 'scenes.md');
const SCENES_PATH_CN = join(__dirname, '..', 'prompts', 'scenes-cn.md');
const TAIL_OUTLINE_PATH = join(__dirname, '..', 'prompts', 'tail-outline.md');

export const VALID_TAIL_ENDINGS = ['GOOD', 'BITTERSWEET', 'SPECIAL'];

// ─── Scene content sanitization ──────────────────────────────────────────────

const SCENE_TAG_RE = /\[(narrator|character:[^\]]*|player|choice)\]/i;

/**
 * Sanitize raw LLM output that should be scene content.
 * Strips leading preamble (explanations before the first scene tag),
 * trailing commentary after the last meaningful content,
 * and markdown code fences.
 *
 * If the output doesn't contain any scene tags, returns it as-is
 * (better to keep imperfect content than lose it entirely).
 */
export function sanitizeSceneContent(raw, originalContent) {
  if (!raw || typeof raw !== 'string') return originalContent;

  let text = raw.trim();

  // Strip markdown code fences
  if (text.startsWith('```')) {
    text = text.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // If it looks like JSON (LLM wrapped it in an object), try to extract content field
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      if (obj.content && typeof obj.content === 'string') {
        return obj.content;
      }
    } catch {
      // Not valid JSON — continue with text processing
    }
  }

  // Find the first scene tag and strip any preamble before it
  const tagMatch = text.match(SCENE_TAG_RE);
  if (tagMatch) {
    const tagStart = text.indexOf(tagMatch[0]);
    // Only strip preamble if the tag isn't at the very start
    // and the text before it looks like explanation (no scene tags in it)
    if (tagStart > 0) {
      const preamble = text.slice(0, tagStart);
      // If preamble has no scene tags, it's likely LLM explanation — strip it
      if (!SCENE_TAG_RE.test(preamble)) {
        text = text.slice(tagStart);
      }
    }
  }

  // If the result is substantially shorter than the original (>50% loss),
  // the sanitization likely went wrong — keep the original
  if (text.length < originalContent.length * 0.5) {
    return originalContent;
  }

  return text.trim();
}

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
  // Surface JSON-repair invocations so users can spot recurring LLM JSON malformation
  // (each call costs an extra LLM round-trip). chalk.dim keeps it low-visual-weight.
  console.log(chalk.dim(`  [json-repair] ${label}: primary parse failed, invoking LLM repair pass`));

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

export function buildOutlinePrompt(materials, lang = 'en', styleKey, novelType = '', referenceCharacter = '', referenceEvent = '') {
  const templateFile = lang === 'cn' ? OUTLINE_PATH_CN : OUTLINE_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const style = getStyleSafe(styleKey);
  if (style) {
    template += `\n\n## Writing Style\n\n${style.outline}\n`;
  }
  if (novelType) {
    const section = lang === 'cn'
      ? `\n\n## 小说类型要求\n\n这个故事必须是**${novelType}**类型的小说。所有情节、角色、世界观和叙事风格都必须符合此类型的特征和读者期望。\n`
      : `\n\n## Novel Type Requirement\n\nThis story MUST be a **${novelType}** novel. All plot elements, characters, world-building, and narrative style must align with this genre/type and its reader expectations.\n`;
    template += section;
  }
  if (referenceCharacter) {
    const section = lang === 'cn'
      ? `\n\n## 参考角色（必须使用）\n\n本故事必须包含以下预先定义的角色。请在 episodes 与人物列表中完整保留该角色的姓名、身份、性格、背景、动机与弧光；不要替换或改名。其他角色可按需要虚构。\n\n---\n${referenceCharacter}\n---\n`
      : `\n\n## Reference Character (REQUIRED)\n\nThis story MUST feature the following predefined character. Preserve their name, identity, traits, background, motivations, and arc exactly as described across episodes and character lists. Do NOT rename or replace them. Other characters may be invented as needed.\n\n---\n${referenceCharacter}\n---\n`;
    template += section;
  }
  if (referenceEvent) {
    const section = lang === 'cn'
      ? `\n\n## 参考事件（必须使用）\n\n本故事必须围绕以下预定义事件展开。请将其作为核心情节节点编入 episodes 中——保留其事实、情感分量与后果；不要淡化或偏离。事件在剧情中的位置（如开篇触发、高潮揭示或结局）应与其叙事分量相匹配。\n\n---\n${referenceEvent}\n---\n`
      : `\n\n## Reference Event (REQUIRED)\n\nThis story MUST be built around the following predefined event. Weave it into the episode structure as a load-bearing plot beat — preserve its facts, emotional weight, and consequences; do not sanitize or drift from it. Its position in the episode arc (inciting incident, climactic revelation, or finale) should match its narrative weight.\n\n---\n${referenceEvent}\n---\n`;
    template += section;
  }
  if (materials.newsSource) {
    const ns = materials.newsSource;
    const section = lang === 'cn'
      ? `\n\n## 新闻灵感\n\n这个故事基于一条真实新闻事件创作。\n- 来源: ${ns.url}\n- 主题: ${ns.theme}\n- 情感内核: ${ns.emotionalCore}\n\n重要：不要直接照搬新闻，而是以新闻为灵感进行艺术加工和戏剧化处理。人物和情节应是虚构的，但核心冲突和情感应与新闻事件呼应。\n`
      : `\n\n## News Inspiration\n\nThis story is inspired by a real breaking news event.\n- Source: ${ns.url}\n- Theme: ${ns.theme}\n- Emotional core: ${ns.emotionalCore}\n\nIMPORTANT: Do NOT retell the news literally. Use it as creative inspiration — fictionalize characters and plot, but let the core conflict and emotions echo the real event.\n`;
    template += section;
  }
  return template.replace('{{materials}}', () => JSON.stringify(materials, null, 2));
}

export async function parseOutline(raw) {
  const data = await parseJsonWithRepair(raw, 'outline');

  if (!data.title) throw new Error('Missing required field: title');
  if (!data.synopsis) throw new Error('Missing required field: synopsis');
  if (!data.episodes || data.episodes.length < 2) {
    // The variant pipeline splits episodes into a shared front + divergent tail,
    // so at least 2 episodes are required (1 front + 1 tail) for the three-ending
    // variation system to produce meaningful output.
    throw new Error('Outline must have at least 2 episodes (required for front/tail variant split)');
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
    // Linear stories have no branching — strip any stray episodeChoices the LLM emits.
    ep.episodeChoices = [];
  }

  // Linear stories require exactly one ending episode (the last one)
  const endingCount = data.episodes.filter(ep => ep.isEnding).length;
  if (endingCount === 0) {
    throw new Error('Linear outline must have exactly one ending episode (isEnding: true)');
  }

  // Always produce empty characterQuestions — the player skips that step.
  data.characterQuestions = [];

  return data;
}

export async function generateOutline(materials, options = {}) {
  const lang = options.lang || 'en';
  const style = options.style;
  const novelType = options.novelType || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const prompt = buildOutlinePrompt(materials, lang, style, novelType, referenceCharacter, referenceEvent);
  const raw = await callLLM(prompt, 'outline');
  return await parseOutline(raw);
}

// ─── Tail outline: regenerate back-half with a divergent ending ──────────────

function summarizeEpisodeForTail(ep) {
  const scenes = (ep.scenePlan || [])
    .map((s, i) => `    Scene ${i}: ${s.summary}`)
    .join('\n');
  return `- Episode ${ep.episodeIndex} "${ep.title}"\n${scenes}`;
}

function summarizeSnowflakeForTail(snowflake) {
  if (!snowflake) return '(not available)';
  const lines = [];
  if (snowflake.seed) lines.push(`Seed: ${snowflake.seed}`);
  if (snowflake.characters?.length) {
    lines.push('Characters:');
    for (const c of snowflake.characters) {
      const arc = c.arc ? ` — arc: ${c.arc}` : '';
      lines.push(`  - ${c.name}${c.role ? ` (${c.role})` : ''}${arc}`);
    }
  }
  if (snowflake.setting) lines.push(`Setting: ${snowflake.setting}`);
  return lines.join('\n') || '(none)';
}

export function buildTailOutlinePrompt(baseOutline, splitIdx, targetEnding, snowflake, options = {}) {
  const template = readFileSync(TAIL_OUTLINE_PATH, 'utf8');
  const sorted = [...baseOutline.episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);
  const totalEpisodes = sorted.length;
  const lastIdx = totalEpisodes - 1;
  const tailCount = totalEpisodes - splitIdx;
  const prior = sorted.slice(0, splitIdx);
  const priorEpisodes = prior.map(summarizeEpisodeForTail).join('\n\n');
  const priorLastIdx = splitIdx - 1;

  let filled = template
    .replace(/\{\{splitIdx\}\}/g, String(splitIdx))
    .replace(/\{\{splitIdxPlus1\}\}/g, String(splitIdx + 1))
    .replace(/\{\{lastIdx\}\}/g, String(lastIdx))
    .replace(/\{\{priorLastIdx\}\}/g, String(priorLastIdx))
    .replace(/\{\{tailCount\}\}/g, String(tailCount))
    .replace(/\{\{targetEnding\}\}/g, targetEnding)
    .replace(/\{\{title\}\}/g, baseOutline.title || '')
    .replace(/\{\{synopsis\}\}/g, baseOutline.synopsis || '')
    .replace(/\{\{genres\}\}/g, (baseOutline.genres || []).join(', ') || '(none)')
    .replace(/\{\{priorEpisodes\}\}/g, () => priorEpisodes)
    .replace(/\{\{snowflakeSummary\}\}/g, () => summarizeSnowflakeForTail(snowflake));

  // Append constraint sections so the back half respects the same genre / character / event / news context as the front half.
  const lang = options.lang || 'en';
  const novelType = options.novelType || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const newsSource = options.newsSource || null;

  if (novelType) {
    filled += lang === 'cn'
      ? `\n\n## 小说类型要求\n\n本故事必须保持**${novelType}**类型。后半段的所有情节、基调、语言必须与此类型一致，不得偏移。\n`
      : `\n\n## Novel Type Requirement\n\nThis story MUST remain a **${novelType}** novel. All plot, tone, and language in the back half must stay consistent with this genre — do NOT drift.\n`;
  }
  if (referenceCharacter) {
    filled += lang === 'cn'
      ? `\n\n## 参考角色（必须保留）\n\n前半段已确立的以下预定义角色必须贯穿后半段。保留其姓名、身份、动机与弧光；不得替换或改名。其弧光应在后半段自然推进并收束于所选结局。\n\n---\n${referenceCharacter}\n---\n`
      : `\n\n## Reference Character (PRESERVE)\n\nThe following predefined character established in the front half MUST carry through the back half. Preserve their name, identity, motivations, and arc; do NOT rename or replace them. Their arc should advance naturally and resolve into the chosen ending.\n\n---\n${referenceCharacter}\n---\n`;
  }
  if (referenceEvent) {
    filled += lang === 'cn'
      ? `\n\n## 参考事件（必须延续）\n\n以下预定义事件已在前半段或作为核心背景确立，其后果、情感回响与揭示必须在后半段得到真实的延续与解决，不得淡化或回避。\n\n---\n${referenceEvent}\n---\n`
      : `\n\n## Reference Event (CONTINUE)\n\nThe following predefined event was established in the front half or as core backdrop. Its consequences, emotional echoes, and revelations MUST continue and resolve in the back half — do NOT sanitize or sidestep them.\n\n---\n${referenceEvent}\n---\n`;
  }
  if (newsSource) {
    filled += lang === 'cn'
      ? `\n\n## 新闻灵感（延续）\n\n本故事源自真实新闻事件。主题：${newsSource.theme}。情感内核：${newsSource.emotionalCore}。后半段应延续这一情感内核至结局。\n`
      : `\n\n## News Inspiration (CONTINUE)\n\nThis story was inspired by a real news event. Theme: ${newsSource.theme}. Emotional core: ${newsSource.emotionalCore}. The back half should carry this emotional core through to the chosen ending.\n`;
  }

  return filled;
}

export async function parseTailOutline(raw, splitIdx, totalEpisodes, targetEnding) {
  if (!VALID_TAIL_ENDINGS.includes(targetEnding)) {
    throw new Error(`Invalid tail ending "${targetEnding}" — must be one of ${VALID_TAIL_ENDINGS.join('/')}`);
  }
  const data = await parseJsonWithRepair(raw, 'tail-outline');
  if (!data.episodes || !Array.isArray(data.episodes) || data.episodes.length === 0) {
    throw new Error('Tail outline must contain a non-empty episodes array');
  }

  const lastIdx = totalEpisodes - 1;
  const expectedCount = totalEpisodes - splitIdx;
  if (data.episodes.length !== expectedCount) {
    throw new Error(`Tail outline must have exactly ${expectedCount} episodes (got ${data.episodes.length})`);
  }

  const sorted = [...data.episodes].sort((a, b) => (a.episodeIndex ?? 0) - (b.episodeIndex ?? 0));
  for (let i = 0; i < sorted.length; i++) {
    const ep = sorted[i];
    const expectedIdx = splitIdx + i;
    if (ep.episodeIndex !== expectedIdx) {
      // Coerce to expected index rather than fail — LLMs frequently misnumber.
      ep.episodeIndex = expectedIdx;
    }
    if (!ep.title) throw new Error(`Tail episode ${expectedIdx} missing title`);
    if (!ep.scenePlan || ep.scenePlan.length === 0) {
      throw new Error(`Tail episode "${ep.title}" must have at least 1 scene in scenePlan`);
    }
    for (let j = 0; j < ep.scenePlan.length; j++) {
      if (!ep.scenePlan[j].summary) {
        throw new Error(`Tail episode "${ep.title}" scene ${j} missing summary`);
      }
    }
    // No branching in tail outlines
    ep.episodeChoices = [];
    if (ep.episodeIndex === lastIdx) {
      ep.isEnding = true;
      ep.ending = targetEnding;
    } else {
      ep.isEnding = false;
      delete ep.ending;
    }
  }

  return { episodes: sorted };
}

export async function generateTailOutline(baseOutline, splitIdx, targetEnding, options = {}) {
  const snowflake = options.snowflake || null;
  const prompt = buildTailOutlinePrompt(baseOutline, splitIdx, targetEnding, snowflake, {
    lang: options.lang,
    novelType: options.novelType,
    referenceCharacter: options.referenceCharacter,
    referenceEvent: options.referenceEvent,
    newsSource: options.newsSource,
  });
  const raw = await callLLM(prompt, 'tail-outline');
  return await parseTailOutline(raw, splitIdx, baseOutline.episodes.length, targetEnding);
}

// ─── Step 2: Generate scenes one at a time ────────────────────────────────────

export function buildScenePrompt(outline, sceneIndex, scenePlan, totalScenes, lang = 'en', styleKey, narrativeContext, constraints = {}) {
  const templateFile = lang === 'cn' ? SCENES_PATH_CN : SCENES_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const style = getStyleSafe(styleKey);
  if (style) {
    template += `\n\n## Writing Style\n\n${style.scene}\n`;
  }

  // Inject genre + reference-character + reference-event constraints so individual scene prose
  // stays aligned with the user-supplied constraints (outline/plan carry them transitively,
  // but scene prose can drift without explicit reinforcement).
  const novelType = constraints.novelType || '';
  const referenceCharacter = constraints.referenceCharacter || '';
  const referenceEvent = constraints.referenceEvent || '';
  if (novelType) {
    template += lang === 'cn'
      ? `\n\n## 小说类型要求\n\n本场景属于**${novelType}**类型小说，语言、节奏、基调必须与此类型保持一致。\n`
      : `\n\n## Novel Type Requirement\n\nThis scene is part of a **${novelType}** novel. Language, pacing, and tone must stay consistent with this genre.\n`;
  }
  if (referenceCharacter) {
    template += lang === 'cn'
      ? `\n\n## 参考角色（必须保留）\n\n如本场景涉及以下预定义角色，请严格保留其姓名、身份、言谈方式与动机；不得改名或改变核心特征。\n\n---\n${referenceCharacter}\n---\n`
      : `\n\n## Reference Character (PRESERVE)\n\nIf this scene involves the following predefined character, strictly preserve their name, identity, speech patterns, and motivations — do NOT rename or alter their core traits.\n\n---\n${referenceCharacter}\n---\n`;
  }
  if (referenceEvent) {
    template += lang === 'cn'
      ? `\n\n## 参考事件（必须尊重）\n\n本故事建构于以下预定义事件之上。任何对该事件的描写、回忆或后果都必须忠实于其事实与情感分量，不得淡化。\n\n---\n${referenceEvent}\n---\n`
      : `\n\n## Reference Event (RESPECT)\n\nThis story is built around the following predefined event. Any depiction, recollection, or consequence of this event in the scene must remain faithful to its facts and emotional weight — do NOT sanitize.\n\n---\n${referenceEvent}\n---\n`;
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
  const constraints = {
    novelType: options.novelType || '',
    referenceCharacter: options.referenceCharacter || '',
    referenceEvent: options.referenceEvent || '',
  };
  const prompt = buildScenePrompt(outline, sceneIndex, scenePlan, totalScenes, lang, style, narrativeContext, constraints);
  const raw = await callLLM(prompt, 'scene');
  return await parseScene(raw);
}

// ─── Fallback scene generation ──────────────────────────────────────────────

export function buildRetryScenePrompt(scenePlan, lang = 'en', constraints = {}) {
  const summary = scenePlan.summary || 'A scene in the story';
  const sceneType = scenePlan.sceneType || 'NARRATIVE';
  const novelType = constraints.novelType || '';
  const referenceCharacter = constraints.referenceCharacter || '';
  const referenceEvent = constraints.referenceEvent || '';

  // Build trailing constraint sections so the retry prompt carries the same
  // genre / character / event constraints as the primary buildScenePrompt path.
  // Without this, every first-attempt scene failure drifts away from the user's
  // --type / --character / --event flags on the regenerated scene.
  const constraintSections = [];
  if (novelType) {
    constraintSections.push(lang === 'cn'
      ? `\n## 小说类型要求\n本场景属于**${novelType}**类型，语言、节奏、基调必须一致。`
      : `\n## Novel Type Requirement\nThis scene is part of a **${novelType}** novel. Keep language, pacing, and tone consistent.`);
  }
  if (referenceCharacter) {
    constraintSections.push(lang === 'cn'
      ? `\n## 参考角色（必须保留）\n如本场景涉及以下预定义角色，严格保留其姓名、身份、言谈方式与动机；不得改名或改变核心特征。\n---\n${referenceCharacter}\n---`
      : `\n## Reference Character (PRESERVE)\nIf this scene involves the following predefined character, strictly preserve their name, identity, speech, and motivations.\n---\n${referenceCharacter}\n---`);
  }
  if (referenceEvent) {
    constraintSections.push(lang === 'cn'
      ? `\n## 参考事件（必须尊重）\n本故事建构于以下事件之上；任何描写或后果都必须忠实于其事实与情感分量，不得淡化。\n---\n${referenceEvent}\n---`
      : `\n## Reference Event (RESPECT)\nThis story is built around the following event; any depiction or consequence must remain faithful to its facts and emotional weight.\n---\n${referenceEvent}\n---`);
  }
  const constraintsBlock = constraintSections.length > 0 ? '\n' + constraintSections.join('\n') : '';

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
    ].join('\n') + constraintsBlock;
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
  ].join('\n') + constraintsBlock;
}

export function buildFallbackScene(scenePlan, sceneIndex) {
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
    // Fallback scenes can't branch meaningfully; converge every choice to the
    // next scene (if a sceneIndex is known). Without an index, omit the target
    // rather than emit a bogus one.
    scene.choices = scenePlan.choiceTexts.map((text) => (
      typeof sceneIndex === 'number'
        ? { text, nextSceneIndex: sceneIndex + 1 }
        : { text }
    ));
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
    'Return ONLY the style key as a single word (e.g. "sanderson"). No explanation, no quotes, no punctuation.',
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
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
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
      snowflake = await generateSnowflake(materials, { lang, novelType, referenceCharacter, referenceEvent, log });
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
    outline = await generateOutline(enrichedMaterials, { lang, style, novelType, referenceCharacter, referenceEvent });
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
      plan = await generatePlan(outline, { lang, novelType, referenceCharacter, referenceEvent });
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
  // Linear fallback: for episodes not linked via episodeChoices (purely linear
  // stories, or tail-only variants), each episode inherits context from the
  // previous one by episodeIndex order. Without this, linear episodes would
  // be generated in isolation with no prior-episode context.
  const sortedIdxList = [...outline.episodes].map(e => e.episodeIndex).sort((a, b) => a - b);
  for (let i = 1; i < sortedIdxList.length; i++) {
    const idx = sortedIdxList[i];
    if (parentMap[idx] === undefined) {
      parentMap[idx] = sortedIdxList[i - 1];
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
    // Global scene index is rebuilt by the skip loop below (which adds
    // scenePlan.length for every completed episode), so we start from 0 here
    // to avoid double-counting.
    globalSceneIndex = 0;
    log(`Resuming writing — ${completedEpisodeIndices.size} episode(s) already completed`);
    wlog('writing_resumed_partial', { completedEpisodes: [...completedEpisodeIndices] });
  }

  for (const ep of sortedEpisodes) {
    // Skip episodes completed in a previous run
    if (completedEpisodeIndices.has(ep.episodeIndex)) {
      globalSceneIndex += ep.scenePlan.length;
      continue;
    }
    const episode = { title: ep.title, episodeIndex: ep.episodeIndex, isEnding: !!ep.isEnding, ending: ep.ending || null, scenes: [], episodeChoices: ep.episodeChoices || [] };
    const totalScenes = ep.scenePlan.length;

    log(`Writing episode ${ep.episodeIndex}: "${ep.title}" (${totalScenes} scenes${ep.isEnding ? ', ending' : ''})...`);
    wlog('episode_start', { episodeIndex: ep.episodeIndex, title: ep.title, scenes: totalScenes, isEnding: !!ep.isEnding });

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
          try { setCharacterArc(branchState, sc.name, sc.arc); }
          catch (err) { log(`[state:setCharacterArc "${sc.name}"] ${err.message}`); }
        }
      }
    }
    for (const arc of (plan.plotArcs || [])) {
      try { addPlotArc(branchState, arc); }
      catch (err) { log(`[state:addPlotArc "${arc?.id || '?'}"] ${err.message}`); }
    }
    for (const f of (plan.foreshadowing || [])) {
      try { addForeshadowing(branchState, f); }
      catch (err) { log(`[state:addForeshadowing "${f?.id || '?'}"] ${err.message}`); }
    }
    for (const rel of (plan.relationships || [])) {
      try { addRelationship(branchState, rel.char1, rel.char2, rel.type, rel.description); }
      catch (err) { log(`[state:addRelationship "${rel?.char1}↔${rel?.char2}"] ${err.message}`); }
    }

    // Apply ancestor episodes' context snapshots (everything except current episode)
    for (const ancestorIdx of ancestorPath.slice(0, -1)) {
      const ctx = episodeContexts[ancestorIdx];
      if (ctx) {
        branchHistory.push(...(ctx.compressedHistory || []));
        if (ctx.globalSummary) branchSummary = ctx.globalSummary;
        // Merge motif tracker
        for (const [key, val] of Object.entries(ctx.motifTracker || {})) {
          branchMotifTracker[key] = val;
        }
        // Apply state changes from ancestor (older snapshots may lack some fields)
        const sc = ctx.stateChanges || {};
        for (const [name, char] of Object.entries(sc.characters || {})) {
          try { updateCharacter(branchState, name, char); }
          catch (err) { log(`[state:updateCharacter "${name}"] ${err.message}`); }
        }
        for (const [name, item] of Object.entries(sc.items || {})) {
          try { updateItem(branchState, name, item); }
          catch (err) { log(`[state:updateItem "${name}"] ${err.message}`); }
        }
        for (const revId of sc.revealedIds || []) {
          try { markRevealed(branchState, revId); }
          catch (err) { log(`[state:markRevealed "${revId}"] ${err.message}`); }
        }
        for (const f of sc.reinforcedForeshadowing || []) {
          // Support both old format (plain id string) and new format ({ id, sceneIndex })
          const fId = typeof f === 'string' ? f : f.id;
          const fScene = typeof f === 'string' ? 0 : f.sceneIndex;
          try { reinforceForeshadowing(branchState, fId, fScene); }
          catch (err) { log(`[state:reinforceForeshadowing "${fId}"] ${err.message}`); }
        }
        for (const f of sc.resolvedForeshadowing || []) {
          const fId = typeof f === 'string' ? f : f.id;
          const fScene = typeof f === 'string' ? 0 : f.sceneIndex;
          try { resolveForeshadowing(branchState, fId, fScene); }
          catch (err) { log(`[state:resolveForeshadowing "${fId}"] ${err.message}`); }
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
    const episodeReinforcedForeshadowing = []; // { id, sceneIndex }
    const episodeResolvedForeshadowing = [];  // { id, sceneIndex }
    const episodeCompressedHistory = [];
    let episodeSummary = branchSummary;
    const episodeMotifTracker = { ...branchMotifTracker };
    const recentConsistencyNotes = [];

    for (let i = 0; i < totalScenes; i++) {
      const plan_scene = ep.scenePlan[i];
      log(`  Scene ${i + 1}/${totalScenes}: ${plan_scene.summary.slice(0, 60)}...`);

      // Build narrative context from branch-local state
      // Use branch-local scene position for revelation scheduling (not flat globalSceneIndex)
      const branchLocalSceneIndex = branchSceneCount + i;
      const history = buildHistoryContext([...branchHistory, ...episodeCompressedHistory]);
      const ancestorSet = new Set(ancestorPath);
      const revelations = getAvailableRevelations(branchState, branchLocalSceneIndex, ancestorSet);
      const stateContext = toPromptContext(branchState);

      // Validate state and log warnings
      const stateWarnings = validate(branchState);
      for (const warning of stateWarnings) {
        log(`[state warning] ${warning}`);
      }

      // Get plan scene data for events/pacing using composite key (episodeIndex:sceneIndex)
      const planScene = (plan.sceneMap && plan.sceneMap[`${ep.episodeIndex}:${i}`]) || {};

      // Query vector store for relevant prior context
      // Only include scenes from ancestor episodes to prevent cross-branch leakage
      let knowledgeContext = '';
      if (options.vectorStore) {
        try {
          const query = plan_scene.summary + ' ' + (planScene.events || []).join(' ');
          const results = await queryKnowledge(options.vectorStore, query, 3, branchLocalSceneIndex, ancestorSet);
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
          novelType,
          referenceCharacter,
          referenceEvent,
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
            consistencyNotes: recentConsistencyNotes.length > 0 ? recentConsistencyNotes : undefined,
            sceneTypeRules,
          },
        });
      } catch (firstErr) {
        log(`[scene failed] ${firstErr.message} — retrying with simplified prompt...`);
        wlog('scene_retry', { episodeIndex: ep.episodeIndex, sceneIndex: i, error: firstErr.message });
        try {
          const retryPrompt = buildRetryScenePrompt(plan_scene, lang, {
            novelType,
            referenceCharacter,
            referenceEvent,
          });
          const retryRaw = await callLLM(retryPrompt, 'scene');
          scene = await parseScene(retryRaw);
        } catch (retryErr) {
          log(`[scene retry failed] ${retryErr.message} — using fallback scene`);
          wlog('scene_fallback', { episodeIndex: ep.episodeIndex, sceneIndex: i, error: retryErr.message });
          scene = buildFallbackScene(plan_scene, i);
        }
      }

      // Index scene in vector store for future retrieval
      if (options.vectorStore) {
        try {
          options.vectorStore.add(
            `scene_ep${ep.episodeIndex}_s${i}`,
            scene.content,
            { sceneIndex: branchLocalSceneIndex, episodeIndex: ep.episodeIndex, episodeTitle: ep.title }
          );
        } catch (err) {
          log(`[scene indexing failed] ${err.message}`);
        }
      }

      // Check and fix consistency issues (use branch-local index for cooldown accuracy)
      const consistencyResult = checkConsistency(scene.content, episodeMotifTracker, branchLocalSceneIndex);
      if (consistencyResult.issues.length > 0) {
        log(`Fixing ${consistencyResult.issues.length} consistency issue(s)...`);
        // Feed issues forward so future scenes avoid the same patterns
        recentConsistencyNotes.push(...consistencyResult.issues);
        // Keep only the most recent issues (last 2 scenes worth)
        while (recentConsistencyNotes.length > 10) recentConsistencyNotes.shift();
        try {
          const rewritten = await rewriteForConsistency(scene.content, consistencyResult.issues, lang);
          scene.content = sanitizeSceneContent(rewritten, scene.content);
        } catch (err) {
          log(`[consistency rewrite failed] ${err.message}`);
        }
      }

      // Enrich scene if below word count target
      if (needsEnrichment(scene.content, targetWordsPerScene)) {
        log(`Scene below word target (${targetWordsPerScene}) — enriching...`);
        try {
          const enriched = await enrichScene(scene.content, targetWordsPerScene, lang);
          scene.content = sanitizeSceneContent(enriched, scene.content);
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
        try {
          reinforceForeshadowing(branchState, fId, branchLocalSceneIndex);
          episodeReinforcedForeshadowing.push({ id: fId, sceneIndex: branchLocalSceneIndex });
        } catch (err) { log(`[state:reinforceForeshadowing "${fId}"] ${err.message}`); }
      }
      for (const fId of (planScene.resolveForeshadowing || [])) {
        try {
          resolveForeshadowing(branchState, fId, branchLocalSceneIndex);
          episodeResolvedForeshadowing.push({ id: fId, sceneIndex: branchLocalSceneIndex });
        } catch (err) { log(`[state:resolveForeshadowing "${fId}"] ${err.message}`); }
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

      const sceneWords = countWords(scene.content);
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

    story.episodes.push(episode);

    // Save progress after each completed episode for resume capability
    if (options.onEpisode) {
      options.onEpisode({
        episodes: story.episodes,
        episodeContexts: { ...episodeContexts },
        globalSceneIndex,
      });
    }

    // Persist vector-store embeddings after each episode so a crash mid-run
    // doesn't strand the indexed scenes (the caller's outer save() would
    // otherwise only fire after the whole generation completes).
    if (options.vectorStore?.save) {
      try {
        options.vectorStore.save();
      } catch (err) {
        log(`[vector store save failed] ${err.message} — indexed scenes not persisted for this episode`);
        wlog('vector_store_save_failed', { episodeIndex: ep.episodeIndex, error: err.message });
      }
    }
  }

  // Validate final story
  if (!story.episodes.length) throw new Error('Story must have at least 1 episode');
  for (const ep of story.episodes) {
    if (!ep.scenes.length) throw new Error(`Episode "${ep.title}" has no scenes`);
  }

  return story;
}
