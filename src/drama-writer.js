import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from './llm.js';
import { parseJsonWithRepair } from './json.js';
import { buildReferenceBlock, buildGenreBlock } from './references.js';
import { getStyle, getStyleSafe, listStyles } from './styles.js';
import { getAuthorStyleSafe } from './author-styles.js';
import { initStateFromPlan, sceneKey } from './planner.js';
import { compressClips, buildHistoryContext } from './compressor.js';
import {
  updateCharacter,
  updateItem,
  markRevealed,
  addPlotArc,
  addForeshadowing,
  reinforceForeshadowing,
  resolveForeshadowing,
  addRelationship,
  setCharacterArc,
  toPromptContext,
} from './drama-state.js';
import { checkHookDensity } from './consistency.js';
import { buildBibleBlock, buildProseBlock, compressBibleForEpisode } from './story-bible.js';
import { countWords, needsEnrichment, enrichScene } from './enrichment.js';
import {
  buildSelftellDirective,
  enforceSelftellPOV,
  pickSelftellProtagonist,
  collectOtherCharacterNames,
  substituteProtagonist,
} from './selftell.js';
import { composeScene } from './scene.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OUTLINE_PATH = join(__dirname, '..', 'prompts', 'outline.md');
const TAIL_OUTLINE_PATH = join(__dirname, '..', 'prompts', 'tail-outline.md');

export const VALID_TAIL_ENDINGS = ['爽爆', '苦尽甘来', '反转'];

// Selftell narration + POV enforcement live in selftell.js, and composeScene in
// scene.js, to keep this module focused and avoid circular imports. Re-exported
// here so existing importers/tests can keep pulling them from drama-writer.
export { buildSelftellDirective, enforceSelftellPOV, composeScene };

// JSON extraction + repair helpers are shared via ./json.js.

// ─── Step 1: Generate outline ─────────────────────────────────────────────────

export function buildOutlinePrompt(materials, lang = 'cn', styleKey, genre = '', referenceCharacter = '', referenceEvent = '', options = {}) {
  // options.mode: 'selftell' switches the prompt into first-person POV directives.
  const templateFile = OUTLINE_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const style = getStyleSafe(styleKey);
  if (style) {
    template += `\n\n## Writing Style\n\n${style.outline}\n`;
  }
  if (genre) {
    template += buildGenreBlock(lang,
      `这个故事必须是**${genre}**类型的小说。所有情节、角色、世界观和叙事风格都必须符合此类型的特征和读者期望。`,
      `This story MUST be a **${genre}** novel. All plot elements, characters, world-building, and narrative style must align with this genre/type and its reader expectations.`);
  }
  if (referenceCharacter) {
    template += buildReferenceBlock({
      kind: 'character', lang, content: referenceCharacter,
      instruction: lang === 'cn'
        ? '本故事必须包含以下预先定义的角色。请在 episodes 与人物列表中完整保留该角色的姓名、身份、性格、背景、动机与弧光；不要替换或改名。其他角色可按需要虚构。'
        : 'This story MUST feature the following predefined character. Preserve their name, identity, traits, background, motivations, and arc exactly as described across episodes and character lists. Do NOT rename or replace them. Other characters may be invented as needed.',
    });
  }
  if (referenceEvent) {
    template += buildReferenceBlock({
      kind: 'event', lang, content: referenceEvent,
      instruction: lang === 'cn'
        ? '本故事必须围绕以下预定义事件展开。请将其作为核心情节节点编入 episodes 中——保留其事实、情感分量与后果；不要淡化或偏离。事件在剧情中的位置（如开篇触发、高潮揭示或结局）应与其叙事分量相匹配。'
        : 'This story MUST be built around the following predefined event. Weave it into the episode structure as a load-bearing plot beat — preserve its facts, emotional weight, and consequences; do not sanitize or drift from it. Its position in the episode arc (inciting incident, climactic revelation, or finale) should match its narrative weight.',
    });
  }
  if (materials.newsSource) {
    const ns = materials.newsSource;
    const section = lang === 'cn'
      ? `\n\n## 新闻灵感\n\n这个故事基于一条真实新闻事件创作。\n- 来源: ${ns.url}\n- 主题: ${ns.theme}\n- 情感内核: ${ns.emotionalCore}\n\n重要：不要直接照搬新闻，而是以新闻为灵感进行艺术加工和戏剧化处理。人物和情节应是虚构的，但核心冲突和情感应与新闻事件呼应。\n`
      : `\n\n## News Inspiration\n\nThis story is inspired by a real breaking news event.\n- Source: ${ns.url}\n- Theme: ${ns.theme}\n- Emotional core: ${ns.emotionalCore}\n\nIMPORTANT: Do NOT retell the news literally. Use it as creative inspiration — fictionalize characters and plot, but let the core conflict and emotions echo the real event.\n`;
    template += section;
  }
  if (options.bible && options.fidelity) {
    template += '\n\n' + buildBibleBlock(options.bible, options.fidelity) + '\n';
    const totalChapters = options.totalChapters || 0;
    const rangeRule = options.fidelity === 'tight'
      ? `必填，且所有 episode.sourceChapterRange 合并后必须覆盖 [1..${totalChapters}] 全部章节，按顺序无遗漏。`
      : options.fidelity === 'medium'
      ? `在合理对应章节时填写 [start, end]（章节区间），否则可省略。`
      : `不填写。`;
    template += `\n\n请在每集 episode 对象中加入 \`sourceChapterRange: [start, end]\` 字段：\n- ${options.fidelity}: ${rangeRule}\n`;
  }
  // Episode/clip count directive. The base template only states the generic
  // 10–40 集 / 4–10 片段 ranges; when the caller specifies exact counts
  // (--episodes / --clips-per-episode) we must tell the LLM, otherwise the
  // flags are silently ignored. Skipped under a bible: there, chapter coverage
  // (sourceChapterRange) drives the episode count instead.
  if (!options.bible) {
    const eps = options.episodesPerDrama;
    const clips = options.clipsPerEpisode;
    const parts = [];
    if (Number.isInteger(eps)) {
      parts.push(lang === 'cn'
        ? `本剧必须正好 **${eps} 集**（episodes 数组长度 = ${eps}，episodeIndex 从 0 到 ${eps - 1}）。`
        : `This drama MUST have exactly **${eps} episodes** (episodes array length = ${eps}, episodeIndex 0..${eps - 1}).`);
    }
    if (Number.isInteger(clips)) {
      parts.push(lang === 'cn'
        ? `每集应有约 **${clips} 个片段**（clipPlan 长度 ≈ ${clips}，可 ±1 以服务剧情节奏）。`
        : `Each episode should have about **${clips} clips** (clipPlan length ≈ ${clips}, ±1 is acceptable for pacing).`);
    }
    if (parts.length) {
      const heading = lang === 'cn' ? '集数 / 片段数要求' : 'Episode / Clip Count Requirement';
      template += `\n\n## ${heading}\n\n${parts.join('\n')}\n`;
    }
  }
  if (options.mode === 'selftell') {
    template += '\n' + buildSelftellDirective(lang, 'outline');
  }
  return template.replace('{{materials}}', () => JSON.stringify(materials, null, 2));
}

/**
 * Validates that a tight-fidelity outline's sourceChapterRange fields cover [1..N].
 * No-op for medium/loose. Throws with descriptive message on failure.
 */
export function validateOutlineChapterCoverage(outline, fidelity, totalChapters) {
  if (fidelity !== 'tight') return;
  if (!outline.episodes || !outline.episodes.length) {
    throw new Error('validateOutlineChapterCoverage: outline has no episodes');
  }
  const ranges = [];
  for (const ep of outline.episodes) {
    if (!Array.isArray(ep.sourceChapterRange) || ep.sourceChapterRange.length !== 2) {
      throw new Error(`validateOutlineChapterCoverage: episode ${ep.episodeIndex ?? '?'} missing sourceChapterRange`);
    }
    ranges.push(ep.sourceChapterRange);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let cursor = 1;
  for (const [s, e] of ranges) {
    if (s > cursor) throw new Error(`validateOutlineChapterCoverage: gap before chapter ${s} (cursor=${cursor})`);
    if (e + 1 > cursor) cursor = e + 1;
  }
  if (cursor - 1 < totalChapters) {
    throw new Error(`validateOutlineChapterCoverage: coverage ends at ${cursor - 1}, expected ${totalChapters}`);
  }
}

export const VALID_ENDINGS = ['爽爆', '苦尽甘来', '反转'];

export const ENDING_LABEL_TO_ENUM = {
  '爽爆':   'GOOD',     // unambiguous win
  '苦尽甘来': 'NEUTRAL',  // bittersweet-but-positive
  '反转':   'SPECIAL',  // final twist outside the standard taxonomy
};

// composeScene lives in ./scene.js (re-exported above) so selftell.js can use
// it without a circular import.

// Query the vector store for scenes most relevant to the upcoming clip and
// format them for prompt injection. Restricted to clips from OTHER episodes
// (the current episode's clips are already carried in episodeRecentDigests),
// so retrieval surfaces cross-episode callbacks/setups. Returns '' when there
// is no store, no signal, or on any error — retrieval is strictly additive.
export function retrieveRelatedScenes(vectorStore, query, currentEpisodeIndex, log = () => {}) {
  if (!vectorStore || typeof vectorStore.search !== 'function' || !query) return '';
  try {
    const hits = vectorStore.search(query, 5)
      .filter(h => h.score > 0 && h.metadata?.episodeIndex !== currentEpisodeIndex)
      .slice(0, 2);
    if (!hits.length) return '';
    return hits.map(h => {
      const epi = h.metadata?.episodeIndex ?? '?';
      const text = (h.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return `【第${epi}集相关片段】${text}`;
    }).join('\n');
  } catch (err) {
    log(`[scene retrieval failed] ${err.message}`);
    return '';
  }
}

// Cheap, no-LLM digest of a just-written clip, shaped like a compressClips
// result so buildHistoryContext can format it. Used for within-episode
// continuity; the episode-level LLM compression handles cross-episode carry.
function localSceneDigest(scene, planSummary = '') {
  const action = (scene && typeof scene.action === 'string') ? scene.action.trim() : '';
  return {
    summary: planSummary || action || (scene && scene.content) || '',
    characterActions: action ? [action] : [],
    plotProgress: [],
    emotionalArc: '',
  };
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

  // Character roster: 3–7 phonetically distinct named characters required for 短剧 viewability.
  if (!Array.isArray(data.characters) || data.characters.length < 3 || data.characters.length > 7) {
    throw new Error(`Outline must have 3 to 7 characters, got ${Array.isArray(data.characters) ? data.characters.length : 'none'}`);
  }
  for (const c of data.characters) {
    if (!c.name || !c.role) {
      throw new Error('Each character must have name and role');
    }
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

  // Normalize to a dense 0-based episodeIndex by sorted order. parseOutline
  // only guaranteed uniqueness, not 0..N-1 — but the front/tail split math
  // (worker.js: slice(0, splitIdx)) and sceneMap/ancestor lookups are
  // position-keyed. A 1-based LLM emission would otherwise collide the last
  // front episode with the first renumbered tail episode. Sorting also makes
  // the final-episode ending check below order-independent.
  data.episodes.sort((a, b) => a.episodeIndex - b.episodeIndex);
  data.episodes.forEach((ep, i) => { ep.episodeIndex = i; });

  for (const ep of data.episodes) {
    if (!ep.clipPlan || ep.clipPlan.length === 0) {
      throw new Error(`Episode "${ep.title}" must have at least 1 clip in clipPlan`);
    }
    for (let i = 0; i < ep.clipPlan.length; i++) {
      if (!ep.clipPlan[i].summary) {
        throw new Error(`Episode "${ep.title}" clip ${i} missing summary`);
      }
    }
    // Linear stories have no branching — strip any stray episodeChoices the LLM emits.
    ep.episodeChoices = [];
  }

  // Linear dramas require the FINAL episode to be the ending with a valid label.
  const lastEp = data.episodes[data.episodes.length - 1];
  if (!lastEp.isEnding) {
    throw new Error('Final episode must have isEnding: true (linear drama requires a single ending episode)');
  }
  if (!VALID_ENDINGS.includes(lastEp.ending)) {
    throw new Error(`Final episode ending must be one of ${VALID_ENDINGS.join('/')}, got: ${lastEp.ending}`);
  }

  // Always produce empty characterQuestions — the player skips that step.
  data.characterQuestions = [];

  return data;
}

export async function generateOutline(materials, options = {}) {
  const lang = options.lang || 'cn';
  const style = options.style;
  const genre = options.genre || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const bible = options.bible || null;
  const fidelity = options.fidelity || null;
  const totalChapters = options.totalChapters || 0;
  const mode = options.mode || 'default';
  const episodesPerDrama = options.episodesPerDrama;
  const clipsPerEpisode = options.clipsPerEpisode;
  const prompt = buildOutlinePrompt(materials, lang, style, genre, referenceCharacter, referenceEvent, { bible, fidelity, totalChapters, mode, episodesPerDrama, clipsPerEpisode });
  const raw = await callLLM(prompt, 'outline');
  return await parseOutline(raw);
}

// ─── Tail outline: regenerate back-half with a divergent ending ──────────────

function summarizeEpisodeForTail(ep) {
  const clips = (ep.clipPlan || [])
    .map((s, i) => `    Scene ${i}: ${s.summary}`)
    .join('\n');
  return `- Episode ${ep.episodeIndex} "${ep.title}"\n${clips}`;
}

function summarizeSnowflakeForTail(snowflake) {
  if (!snowflake) return '(not available)';
  const lines = [];
  if (snowflake.coreSeed) lines.push(`Seed: ${snowflake.coreSeed}`);
  if (snowflake.characters?.length) {
    lines.push('Characters:');
    for (const c of snowflake.characters) {
      const arc = c.arc?.final ? ` — arc-final: ${c.arc.final}` : (typeof c.arc === 'string' && c.arc ? ` — arc: ${c.arc}` : '');
      lines.push(`  - ${c.name}${c.role ? ` (${c.role})` : ''}${arc}`);
    }
  }
  if (snowflake.world?.physical?.geography) lines.push(`Setting: ${snowflake.world.physical.geography}`);
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
  const lang = options.lang || 'cn';
  const genre = options.genre || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const newsSource = options.newsSource || null;
  const bible = options.bible || null;
  const fidelity = options.fidelity || null;
  const totalChapters = options.totalChapters || 0;

  if (genre) {
    filled += buildGenreBlock(lang,
      `本故事必须保持**${genre}**类型。后半段的所有情节、基调、语言必须与此类型一致，不得偏移。`,
      `This story MUST remain a **${genre}** novel. All plot, tone, and language in the back half must stay consistent with this genre — do NOT drift.`);
  }
  if (referenceCharacter) {
    filled += buildReferenceBlock({
      kind: 'character', lang, variant: 'preserve', content: referenceCharacter,
      instruction: lang === 'cn'
        ? '前半段已确立的以下预定义角色必须贯穿后半段。保留其姓名、身份、动机与弧光；不得替换或改名。其弧光应在后半段自然推进并收束于所选结局。'
        : 'The following predefined character established in the front half MUST carry through the back half. Preserve their name, identity, motivations, and arc; do NOT rename or replace them. Their arc should advance naturally and resolve into the chosen ending.',
    });
  }
  if (referenceEvent) {
    filled += buildReferenceBlock({
      kind: 'event', lang, variant: 'continue', content: referenceEvent,
      instruction: lang === 'cn'
        ? '以下预定义事件已在前半段或作为核心背景确立，其后果、情感回响与揭示必须在后半段得到真实的延续与解决，不得淡化或回避。'
        : 'The following predefined event was established in the front half or as core backdrop. Its consequences, emotional echoes, and revelations MUST continue and resolve in the back half — do NOT sanitize or sidestep them.',
    });
  }
  if (newsSource) {
    filled += lang === 'cn'
      ? `\n\n## 新闻灵感（延续）\n\n本故事源自真实新闻事件。主题：${newsSource.theme}。情感内核：${newsSource.emotionalCore}。后半段应延续这一情感内核至结局。\n`
      : `\n\n## News Inspiration (CONTINUE)\n\nThis story was inspired by a real news event. Theme: ${newsSource.theme}. Emotional core: ${newsSource.emotionalCore}. The back half should carry this emotional core through to the chosen ending.\n`;
  }
  if (bible && fidelity) {
    filled += '\n\n' + buildBibleBlock(bible, fidelity) + '\n';
    // Compute the chapter range the tail must cover by inspecting the front
    // episodes' sourceChapterRange. Under tight fidelity the front already
    // satisfied [1..frontMaxChapter]; the tail must cover [frontMaxChapter+1, totalChapters].
    let frontMaxChapter = 0;
    for (const ep of prior) {
      if (Array.isArray(ep.sourceChapterRange) && ep.sourceChapterRange.length === 2) {
        if (ep.sourceChapterRange[1] > frontMaxChapter) frontMaxChapter = ep.sourceChapterRange[1];
      }
    }
    const tailStartChapter = frontMaxChapter + 1;
    const rangeRule = fidelity === 'tight'
      ? `必填，且所有 tail 集合并后必须覆盖 [${tailStartChapter}..${totalChapters}] 全部章节，按顺序无遗漏。`
      : fidelity === 'medium'
      ? `在合理对应章节时填写 [start, end]，否则可省略；若填写须落在 [${tailStartChapter}..${totalChapters}] 区间内。`
      : `不填写。`;
    filled += `\n\n请在每集 episode 对象中加入 \`sourceChapterRange: [start, end]\` 字段：\n- ${fidelity}: ${rangeRule}\n`;
  }

  if (options.mode === 'selftell') {
    filled += '\n' + buildSelftellDirective(lang, 'tail-outline');
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

  // Validate episodeIndex values strictly: every episode must declare an
  // integer episodeIndex, no duplicates, and the set must equal
  // {splitIdx..lastIdx}. We accept off-by-N where indices are unique and
  // contiguous (LLMs sometimes start from 0 or from 1) — the renumber on
  // line below recovers those cases. We REJECT missing/duplicate/sparse
  // indices because renumbering them by sort order can land the intended
  // ending episode at a non-final position.
  const indices = data.episodes.map(ep => ep.episodeIndex);
  const allIntegers = indices.every(idx => Number.isInteger(idx));
  if (!allIntegers) {
    throw new Error(`Tail outline episodes must all declare an integer episodeIndex (got ${JSON.stringify(indices)})`);
  }
  const indexSet = new Set(indices);
  if (indexSet.size !== indices.length) {
    throw new Error(`Tail outline has duplicate episodeIndex values: ${JSON.stringify(indices)}`);
  }
  const sorted = [...data.episodes].sort((a, b) => a.episodeIndex - b.episodeIndex);
  // Determine renumber offset: if the indices form a contiguous run of length
  // expectedCount (regardless of where they start), shift them to start at
  // splitIdx. Otherwise we have gaps — reject.
  const minIdx = sorted[0].episodeIndex;
  const maxIdx = sorted[sorted.length - 1].episodeIndex;
  if (maxIdx - minIdx + 1 !== expectedCount) {
    throw new Error(`Tail outline episodeIndex values are not contiguous: ${JSON.stringify(indices)}`);
  }
  const offset = splitIdx - minIdx;

  for (let i = 0; i < sorted.length; i++) {
    const ep = sorted[i];
    if (offset !== 0) {
      ep.episodeIndex += offset;
    }
    const expectedIdx = splitIdx + i;
    if (ep.episodeIndex !== expectedIdx) {
      // Should not happen given the contiguity check above — defensive guard.
      throw new Error(`Tail outline episode at position ${i} has episodeIndex ${ep.episodeIndex}, expected ${expectedIdx}`);
    }
    if (!ep.title) throw new Error(`Tail episode ${expectedIdx} missing title`);
    if (!ep.clipPlan || ep.clipPlan.length === 0) {
      throw new Error(`Tail episode "${ep.title}" must have at least 1 scene in clipPlan`);
    }
    for (let j = 0; j < ep.clipPlan.length; j++) {
      if (!ep.clipPlan[j].summary) {
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
  const totalEpisodes = baseOutline.episodes.length;
  const lastIdx = totalEpisodes - 1;
  const tailCount = totalEpisodes - splitIdx;
  const log = options.log || (() => {});
  const prompt = buildTailOutlinePrompt(baseOutline, splitIdx, targetEnding, snowflake, {
    lang: options.lang,
    genre: options.genre,
    referenceCharacter: options.referenceCharacter,
    referenceEvent: options.referenceEvent,
    newsSource: options.newsSource,
    bible: options.bible,
    fidelity: options.fidelity,
    totalChapters: options.totalChapters,
    mode: options.mode,
  });
  const raw = await callLLM(prompt, 'tail-outline');
  try {
    return await parseTailOutline(raw, splitIdx, totalEpisodes, targetEnding);
  } catch (err) {
    // The H6 strict validator rejects missing/duplicate/sparse indices. Give
    // the LLM one corrective shot before propagating the failure — most
    // index-shape mistakes are recoverable with a clearer instruction.
    log(`[tail-outline retry] ${err.message} — sending corrective prompt`);
    const corrective = [
      'Your previous tail outline was rejected:',
      err.message,
      '',
      'REQUIRED: Produce exactly the episodes with episodeIndex values in the contiguous range:',
      `  ${Array.from({ length: tailCount }, (_, i) => splitIdx + i).join(', ')}`,
      `(${tailCount} episodes total; the last episode (episodeIndex ${lastIdx}) must have isEnding: true and ending: "${targetEnding}").`,
      '',
      'Original prompt follows:',
      '',
      prompt,
    ].join('\n');
    const raw2 = await callLLM(corrective, 'tail-outline');
    return await parseTailOutline(raw2, splitIdx, totalEpisodes, targetEnding);
  }
}

// ─── Step 2: Generate clips one at a time ────────────────────────────────────

const CLIPS_PROMPT_PATH = join(__dirname, '..', 'prompts', 'clips.md');

/**
 * Build the per-clip generation prompt (new drama-pipeline signature).
 *
 * @param {object} ctx
 * @param {object} ctx.outline           Full drama outline
 * @param {object} ctx.episode           Current episode object
 * @param {number} ctx.clipIndex         0-based clip position within episode
 * @param {number} ctx.totalClips        Number of clips in this episode
 * @param {string} ctx.clipSummary       Plan summary for this clip
 * @param {boolean} [ctx.isConclusion]   True only for last clip of last episode
 * @param {string} [ctx.priorClipDigest] Compressed summary of prior clips
 * @param {string} [ctx.retrievedScenes] Semantically-retrieved earlier scenes (vector store)
 * @param {string} [ctx.tropeSection]    `## Clip` injection from the trope file
 * @param {string} [ctx.referenceCharacter]
 * @param {string} [ctx.referenceEvent]
 */
export function buildClipPrompt(ctx) {
  const {
    outline = {},
    episode = {},
    clipIndex = 0,
    totalClips = 1,
    clipSummary = '',
    isConclusion = false,
    priorClipDigest = '',
    retrievedScenes = '',
    stateContext = '',
    tropeSection = '',
    referenceCharacter = '',
    referenceEvent = '',
    bible = null,
    chapters = null,
    fidelity = null,
    episodeChapterRange = null,
    mode = 'default',
    lang = 'cn',
    authorVoice = '',
  } = ctx || {};

  let template = readFileSync(CLIPS_PROMPT_PATH, 'utf8');
  let rendered = template
    .replace(/\{\{title\}\}/g, outline.title || '')
    .replace(/\{\{synopsis\}\}/g, outline.synopsis || '')
    .replace(/\{\{characters\}\}/g, JSON.stringify(outline.characters || [], null, 2))
    .replace(/\{\{episodeTitle\}\}/g, episode.title || '')
    .replace(/\{\{episodeIndex\}\}/g, String(episode.episodeIndex ?? 0))
    .replace(/\{\{clipIndex\}\}/g, String(clipIndex))
    .replace(/\{\{totalClips\}\}/g, String(totalClips))
    .replace(/\{\{clipSummary\}\}/g, clipSummary || '')
    .replace(/\{\{isConclusion\}\}/g, isConclusion ? 'true' : 'false')
    .replace(/\{\{priorClipDigest\}\}/g, priorClipDigest || '(none)')
    .replace(/\{\{retrievedScenes\}\}/g, () => retrievedScenes || '（无）')
    .replace(/\{\{stateContext\}\}/g, () => stateContext || '（无）')
    .replace(/\{\{tropeSection\}\}/g, tropeSection || '')
    .replace(/\{\{referenceCharacter\}\}/g, referenceCharacter || '')
    .replace(/\{\{referenceEvent\}\}/g, referenceEvent || '');

  if (bible && fidelity && episodeChapterRange) {
    const compressed = compressBibleForEpisode(bible, episodeChapterRange);
    rendered += '\n\n' + buildBibleBlock(compressed, fidelity) + '\n';
    if (chapters) {
      const proseBlock = buildProseBlock(chapters, episodeChapterRange, fidelity, 4000);
      if (proseBlock) rendered += '\n\n' + proseBlock + '\n';
    }
  }

  if (mode === 'selftell') {
    rendered += '\n' + buildSelftellDirective(lang, 'clip');
  }

  if (authorVoice) {
    rendered += '\n\n## 文风 / Author Voice\n\n'
      + '请用以下作家的文风来写作。这只影响遣词、节奏、意象与句子质感——'
      + '不改变剧情、套路结构、人物或事件。\n\n'
      + authorVoice;
  }

  return rendered;
}

const CLIP_LIMITS = { setting: 20, action: 80, dialogue: 60, hook: 30 };

function countCnChars(s) {
  // Count Chinese-script characters only (Unicode CJK ranges).
  // Whitespace, punctuation, and ASCII don't count toward the spoken-content budget.
  return (s.match(/[一-鿿㐀-䶿]/g) || []).length;
}

function stripDialogueAnnotations(s) {
  // Remove |voice:xxx attributes inside [character:Name|voice:X] tags.
  let out = s.replace(/\|voice:[a-z]+/g, '');
  // Remove entire [player]\n... blocks up to the next tag or end of string.
  out = out.replace(/\[player\][^[]*?(?=\[|$)/g, '');
  return out.trim();
}

export async function parseClip(raw) {
  const data = await parseJsonWithRepair(raw, 'clip');

  if (!Number.isInteger(data.clipIndex)) throw new Error('clip missing clipIndex');
  for (const field of ['setting', 'action', 'dialogue']) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      throw new Error(`clip missing ${field}`);
    }
  }

  // Sanitize dialogue: drop voice IDs and player blocks.
  data.dialogue = stripDialogueAnnotations(data.dialogue);

  // CN-char length limits.
  for (const [field, limit] of Object.entries(CLIP_LIMITS)) {
    const value = data[field] || '';
    const n = countCnChars(value);
    if (n > limit) {
      throw new Error(`clip.${field} has ${n} CN chars, max ${limit}`);
    }
  }

  // Hook required for non-conclusion clips.
  if (!data.isConclusion && (!data.hook || data.hook.trim().length === 0)) {
    throw new Error('clip.hook required for non-conclusion clips');
  }

  // Conclusion validation.
  let composedConclusion = null;
  if (data.isConclusion) {
    if (!data.conclusion || typeof data.conclusion !== 'object') {
      throw new Error('conclusion clip must have a conclusion object');
    }
    if (data.conclusion.type !== 'DRAMA_END') {
      throw new Error(`conclusion.type must be 'DRAMA_END', got: ${data.conclusion.type}`);
    }
    if (!VALID_ENDINGS.includes(data.conclusion.ending)) {
      throw new Error(`conclusion.ending must be one of ${VALID_ENDINGS.join('/')}, got: ${data.conclusion.ending}`);
    }
    composedConclusion = {
      title: data.conclusion.title,
      overview: data.conclusion.overview,
      type: 'STORY_END',
      ending: ENDING_LABEL_TO_ENUM[data.conclusion.ending],
    };
  }

  // Default durationSec if missing/out-of-range.
  if (typeof data.durationSec !== 'number' || data.durationSec < 6 || data.durationSec > 20) {
    data.durationSec = 12;
  }

  // Compose scene-shaped output with structured beats kept enumerable so the
  // uploader carries them through to the server (mini-drama TTS / player
  // pipelines consume the per-beat fields directly).
  const content = composeScene({
    setting: data.setting,
    action: data.action,
    dialogue: data.dialogue,
    hook: data.hook,
  });
  return {
    clipIndex: data.clipIndex,
    content,
    setting: data.setting,
    action: data.action,
    dialogue: data.dialogue,
    hook: data.hook,
    durationSec: data.durationSec,
    isConclusion: !!data.isConclusion,
    choices: [],
    conclusion: composedConclusion,
  };
}

export async function generateClip(ctx) {
  const prompt = buildClipPrompt(ctx);
  // Use the injected llmFn when the caller threaded one through (tests / the
  // generateDrama loop); fall back to callLLM for direct callers.
  const llm = ctx.llmFn || callLLM;
  const raw = await llm(prompt, 'clip');
  const parsed = await parseClip(raw);
  if (ctx && ctx.mode === 'selftell') {
    return enforceSelftellPOV(parsed, ctx);
  }
  return parsed;
}

// Selftell POV enforcement (enforceSelftellPOV + helpers) lives in ./selftell.js.

// ─── Retry & fallback ────────────────────────────────────────────────────────

/**
 * Simplified retry prompt invoked when the primary clip prompt's output failed
 * to parse. Includes the schema constraints + the prior parse error so the
 * model can correct itself.
 */
export function buildRetryClipPrompt(ctx = {}) {
  const { clipSummary = '', prevError = '', isConclusion = false, ending = '爽爆', mode = 'default', lang = 'cn', authorVoice = '' } = ctx;
  const tail = isConclusion
    ? `\nThis is the conclusion clip. Output a "conclusion" object: { "title": "...", "overview": "...", "type": "DRAMA_END", "ending": "${ending}" } and you may leave "hook" empty.`
    : '\nThis is a non-conclusion clip. Output a non-empty "hook" field (≤30 CN chars).';
  const parts = [
    `Previous attempt failed: ${prevError || 'invalid output'}.`,
    `Generate one short-drama clip (10–15 seconds) based on this summary:`,
    clipSummary,
    `CN-char limits: setting≤20, action≤80, dialogue≤60, hook≤30.`,
    `Output ONLY a single JSON object matching the clip schema. No markdown fences, no commentary.`,
    tail,
  ];
  if (mode === 'selftell') {
    parts.push(buildSelftellDirective(lang, 'clip'));
  }
  if (authorVoice) {
    parts.push('文风（仅影响遣词、节奏与意象，不改变剧情、人物或事件）：\n' + authorVoice);
  }
  return parts.join('\n');
}

/**
 * Synthesize a parser-valid clip when LLM retries are exhausted. Output must
 * round-trip through parseClip without throwing.
 */
export function buildFallbackClip(ctx = {}) {
  const {
    clipIndex = 0,
    summary = '',
    isConclusion = false,
    ending = '爽爆',
    mode = 'default',
    outline = null,
  } = ctx;
  const truncate = (s, n) => {
    const chars = (s || '').match(/[一-鿿㐀-䶿]/g) || [];
    return chars.slice(0, n).join('');
  };
  const isSelftell = mode === 'selftell';
  const setting  = '场景 · 时间 · 氛围';
  let action     = truncate(summary || '动作描述', 80) || '动作描述';
  let dialogue   = '[narrator]\n' + (truncate(summary, 50) || '叙述');
  const hook     = isConclusion ? '' : '镜头特写关键道具';
  const durationSec = 12;
  if (isSelftell) {
    // Cheap first-person rewrite of the fallback: substitute the protagonist's
    // name with "我", and prepend "我：" if the action still doesn't open in
    // first person. Use the overlap-safe substitution so co-stars whose name
    // contains the protagonist as a substring aren't mangled. The substitution
    // never grows CN-char counts (1 char in, 1 char out); the prepend trims
    // to keep action under the 80 CN-char cap.
    const proto = pickSelftellProtagonist(outline);
    if (proto) {
      const others = collectOtherCharacterNames(outline, proto);
      action = substituteProtagonist(action, proto, others);
      dialogue = substituteProtagonist(dialogue, proto, others);
    }
    if (!action.startsWith('我')) {
      action = '我：' + truncate(action, 78);
    }
  }

  const content = composeScene({ setting, action, dialogue, hook });
  let conclusion = null;
  if (isConclusion) {
    const safeEnding = VALID_ENDINGS.includes(ending) ? ending : '爽爆';
    let concTitle = '结局';
    let concOverview = summary || '故事结束';
    if (isSelftell) {
      // Rewrite the conclusion fields too so the ending stays in first person.
      const proto = pickSelftellProtagonist(outline);
      if (proto) {
        const others = collectOtherCharacterNames(outline, proto);
        concTitle = substituteProtagonist(concTitle, proto, others);
        concOverview = substituteProtagonist(concOverview, proto, others);
      }
    }
    conclusion = {
      title: concTitle,
      overview: concOverview,
      type: 'STORY_END',
      ending: ENDING_LABEL_TO_ENUM[safeEnding],
    };
  }
  return {
    clipIndex,
    content,
    setting,
    action,
    dialogue,
    hook,
    durationSec,
    isConclusion: !!isConclusion,
    choices: [],
    conclusion,
  };
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
    'Return ONLY the trope key as a single phrase (e.g. "战神归来"). No explanation, no quotes, no punctuation.',
  ].join('\n');
}

export async function pickStyle(materials) {
  const prompt = buildPickStylePrompt(materials);
  const raw = await callLLM(prompt, 'style');
  // Strip leading/trailing whitespace and any wrapping quotes/punctuation.
  // Trope keys are CN strings (e.g. "战神归来"), so we must keep CJK chars but
  // strip both ASCII punctuation (",.;:!?` and CJK punctuation (。，；：！？「」『』)
  // that the LLM commonly appends.
  const TRIM_CHARS = /^[\s"'`.,;:!?。，；：！？「」『』《》]+|[\s"'`.,;:!?。，；：！？「」『』《》]+$/g;
  const key = raw.trim().replace(TRIM_CHARS, '');
  try {
    getStyle(key);
    return key;
  } catch {
    return null;
  }
}

// ─── Full pipeline: outline → clips ──────────────────────────────────────────

export async function generateDrama(materials, options = {}) {
  const lang = options.lang || 'cn';
  const genre = options.genre || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const bible = options.bible || null;
  const chapters = options.chapters || null;
  const fidelity = options.fidelity || null;
  const mode = options.mode || 'default';
  const authorStyle = options.authorStyle || '';
  const authorVoice = getAuthorStyleSafe(authorStyle)?.scene || '';
  // Optional scene-length floor (CN words). 0/undefined = disabled (default).
  const targetCharsPerClip = options.targetCharsPerClip || 0;
  let style = options.style;
  const log = options.log || (() => {});
  const wlog = options.wlog || (() => {});
  // Injectable LLM (tests pass a canned fn; production falls back to callLLM).
  // Threaded into generateClip, the clip-retry call, and per-episode
  // compressClips so a single injected fn drives the whole loop.
  const llmFn = options.llmFn || callLLM;

  // Auto-pick trope if not specified
  if (!style || style === 'default') {
    log('Selecting best 短剧 trope for this story...');
    const picked = await pickStyle(materials);
    if (picked) {
      const def = getStyle(picked);
      style = picked;
      log(`Selected trope: ${def.name}`);
    } else {
      log('[trope auto-pick] LLM returned an unrecognized key — generating without a fixed trope');
      wlog('trope_pick_failed');
    }
  }

  // Step 0: Snowflake architecture (optional, enriches outline)
  let snowflake = options.savedSnowflake || null;
  if (!snowflake) {
    try {
      log('Building story architecture (Snowflake method)...');
      snowflake = await generateSnowflake(materials, { lang, genre, referenceCharacter, referenceEvent, mode, log });
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
    const totalChapters = chapters ? chapters.length : 0;
    outline = await generateOutline(enrichedMaterials, { lang, style, genre, referenceCharacter, referenceEvent, bible, fidelity, totalChapters, mode });
    if (bible && fidelity === 'tight') {
      validateOutlineChapterCoverage(outline, fidelity, totalChapters);
    }
    if (options.onOutline) options.onOutline(outline);
  } else {
    log('Resuming — outline already generated');
  }
  const totalEpisodes = outline.episodes.length;
  const totalScenePlanned = outline.episodes.reduce((sum, ep) => sum + ep.clipPlan.length, 0);
  const endingCount = outline.episodes.filter(ep => ep.isEnding).length;
  log(`Outline: "${outline.title}" — ${totalEpisodes} episodes (${endingCount} endings), ${totalScenePlanned} clips total`);

  // Step 2: Generate plan (planning agent) — optional, continues without if it fails
  let plan = options.savedPlan || null;
  if (!plan) {
    plan = { clips: [], characters: [], items: [], locations: [], revelations: [] };
    try {
      log('Planning scene details, events, and revelations...');
      const aggregateChapterRange = chapters && chapters.length ? [1, chapters.length] : null;
      plan = await generatePlan(outline, { lang, genre, referenceCharacter, referenceEvent, bible, chapters, fidelity, aggregateChapterRange, mode });
      if (options.onPlan) options.onPlan(plan);
      log(`Plan: ${plan.clips.length} clips planned, ${(plan.revelations || []).length} revelations scheduled`);
    } catch (planErr) {
      log(`[planning failed] ${planErr.message} — continuing without plan`);
    }
  } else {
    log('Resuming — plan already generated');
  }

  // Step 4: Generate each episode's clips with narrative intelligence
  // Episodes form a branching tree — each branch gets its own narrative context
  const story = {
    title: outline.title,
    synopsis: outline.synopsis,
    trope: outline.trope || '',
    genre: outline.genre || '',
    genres: outline.genres || [],
    tags: outline.tags || [],
    lang: outline.lang || lang,
    characters: outline.characters || [],
    fandom: outline.fandom || null,
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

  let globalClipIndex = 0;

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
    // clipPlan.length for every completed episode), so we start from 0 here
    // to avoid double-counting.
    globalClipIndex = 0;
    log(`Resuming writing — ${completedEpisodeIndices.size} episode(s) already completed`);
    wlog('writing_resumed_partial', { completedEpisodes: [...completedEpisodeIndices] });
  }

  for (const ep of sortedEpisodes) {
    // Skip episodes completed in a previous run
    if (completedEpisodeIndices.has(ep.episodeIndex)) {
      globalClipIndex += ep.clipPlan.length;
      continue;
    }
    const episode = { title: ep.title, episodeIndex: ep.episodeIndex, isEnding: !!ep.isEnding, ending: ep.ending || null, scenes: [], episodeChoices: ep.episodeChoices || [] };
    const totalClips = ep.clipPlan.length;

    log(`Writing episode ${ep.episodeIndex}: "${ep.title}" (${totalClips} clips${ep.isEnding ? ', ending' : ''})...`);
    wlog('episode_start', { episodeIndex: ep.episodeIndex, title: ep.title, clips: totalClips, isEnding: !!ep.isEnding });

    // Reconstruct branch-local narrative context from ancestor path
    const ancestorPath = getAncestorPath(ep.episodeIndex);
    const branchHistory = [];

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
          // Support both old format (plain id string) and new format ({ id, clipIndex })
          const fId = typeof f === 'string' ? f : f.id;
          const fScene = typeof f === 'string' ? 0 : f.clipIndex;
          try { reinforceForeshadowing(branchState, fId, fScene); }
          catch (err) { log(`[state:reinforceForeshadowing "${fId}"] ${err.message}`); }
        }
        for (const f of sc.resolvedForeshadowing || []) {
          const fId = typeof f === 'string' ? f : f.id;
          const fScene = typeof f === 'string' ? 0 : f.clipIndex;
          try { resolveForeshadowing(branchState, fId, fScene); }
          catch (err) { log(`[state:resolveForeshadowing "${fId}"] ${err.message}`); }
        }
      }
    }

    // Compute branch-local scene count: total clips from ancestor episodes
    // This represents how many clips the reader has seen before this episode on this path
    let branchSceneCount = 0;
    for (const ancestorIdx of ancestorPath.slice(0, -1)) {
      const ancestorEp = sortedEpisodes.find(e => e.episodeIndex === ancestorIdx);
      if (ancestorEp) branchSceneCount += ancestorEp.clipPlan.length;
    }

    // Track this episode's own state changes (to save in snapshot)
    const episodeCharChanges = {};
    const episodeItemChanges = {};
    const episodeRevealedIds = [];
    const episodeReinforcedForeshadowing = []; // { id, clipIndex }
    const episodeResolvedForeshadowing = [];  // { id, clipIndex }
    // Within-episode continuity uses cheap local digests of already-written
    // clips (no LLM) so each clip still sees what came before it. The
    // expensive LLM compression runs ONCE per episode (after the loop) to
    // produce the forward-carried summary descendants consume — previously it
    // fired per clip, doubling write-phase LLM calls.
    const episodeRecentDigests = [];

    for (let i = 0; i < totalClips; i++) {
      const plan_clip = ep.clipPlan[i];
      log(`  Scene ${i + 1}/${totalClips}: ${plan_clip.summary.slice(0, 60)}...`);

      // Branch-local clip position is used only for foreshadowing/revelation
      // scheduling (state.js operations). The clip prompt itself is fed
      // priorClipDigest only — state context is intentionally not threaded
      // through (the planner's clipSummary already encodes the relevant beat).
      const branchLocalSceneIndex = branchSceneCount + i;
      const history = buildHistoryContext([...branchHistory, ...episodeRecentDigests]);

      // Get plan scene data for events/pacing using composite key (episodeIndex:clipIndex)
      const planScene = (plan.sceneMap && plan.sceneMap[sceneKey(ep.episodeIndex, i)]) || {};

      // Generate clip via the new ctx-object pipeline (with retry and fallback).
      // Trope `## Clip` section is resolved from the style key.
      const tropeStyle = getStyleSafe(style);
      const tropeSection = tropeStyle?.clip || '';
      const isConcl = !!plan_clip.isConclusion || (ep.isEnding && i === ep.clipPlan.length - 1);
      const concEnding = plan_clip.ending || (ep.isEnding ? ep.ending : '爽爆');
      let scene;
      const episodeChapterRange = bible && Array.isArray(ep.sourceChapterRange) ? ep.sourceChapterRange : null;
      // Semantic retrieval: pull the most relevant scenes from EARLIER episodes
      // (callbacks, planted setups) to supplement the linear recent-clip digest.
      // Scoped to prior episodes so it complements episodeRecentDigests rather
      // than echoing the immediately-preceding clips. Best-effort: any failure
      // (or an empty store) just yields no retrieved context.
      const retrievedScenes = retrieveRelatedScenes(options.vectorStore, plan_clip.summary || ep.title, ep.episodeIndex, log);
      // Inject the structured narrative state (characters/items/revelations/
      // foreshadowing/relationships) accumulated by prior clips so the LLM stays
      // consistent with what's already been established. Best-effort: any error
      // formatting state must not abort clip generation.
      let stateContext = '';
      try { stateContext = toPromptContext(branchState); } catch (err) { log(`[state context] ${err.message}`); }
      try {
        scene = await generateClip({
          outline,
          episode: ep,
          clipIndex: i,
          totalClips,
          clipSummary: plan_clip.summary || '',
          isConclusion: isConcl,
          priorClipDigest: history || '',
          retrievedScenes,
          stateContext,
          tropeSection,
          referenceCharacter,
          referenceEvent,
          bible,
          chapters,
          fidelity,
          episodeChapterRange,
          mode,
          lang,
          authorVoice,
          llmFn,
        });
      } catch (firstErr) {
        log(`[clip failed] ${firstErr.message} — retrying with simplified prompt...`);
        wlog('clip_retry', { episodeIndex: ep.episodeIndex, clipIndex: i, error: firstErr.message });
        try {
          const retryPrompt = buildRetryClipPrompt({
            clipSummary: plan_clip.summary || '',
            prevError: firstErr.message,
            isConclusion: isConcl,
            ending: concEnding,
            mode,
            lang,
            authorVoice,
          });
          const retryRaw = await llmFn(retryPrompt, 'clip');
          scene = await parseClip(retryRaw);
          if (mode === 'selftell') scene = enforceSelftellPOV(scene, { outline });
        } catch (retryErr) {
          log(`[clip retry failed] ${retryErr.message} — using fallback clip`);
          wlog('clip_fallback', { episodeIndex: ep.episodeIndex, clipIndex: i, error: retryErr.message });
          scene = buildFallbackClip({
            clipIndex: i,
            summary: plan_clip.summary || '',
            isConclusion: isConcl,
            ending: concEnding,
            mode,
            outline,
          });
        }
      }

      // Index clip in vector store for future similarity retrieval
      if (options.vectorStore) {
        try {
          options.vectorStore.add(
            `scene_ep${ep.episodeIndex}_s${i}`,
            scene.content,
            { clipIndex: branchLocalSceneIndex, episodeIndex: ep.episodeIndex, episodeTitle: ep.title }
          );
        } catch (err) {
          log(`[scene indexing failed] ${err.message}`);
        }
      }

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
          episodeReinforcedForeshadowing.push({ id: fId, clipIndex: branchLocalSceneIndex });
        } catch (err) { log(`[state:reinforceForeshadowing "${fId}"] ${err.message}`); }
      }
      for (const fId of (planScene.resolveForeshadowing || [])) {
        try {
          resolveForeshadowing(branchState, fId, branchLocalSceneIndex);
          episodeResolvedForeshadowing.push({ id: fId, clipIndex: branchLocalSceneIndex });
        } catch (err) { log(`[state:resolveForeshadowing "${fId}"] ${err.message}`); }
      }

      // Scene enrichment: when a length floor is configured (targetCharsPerClip)
      // and the generated clip is well under it, expand it once via the LLM.
      // Disabled by default (targetCharsPerClip=0 ⇒ needsEnrichment returns
      // false). Best-effort: a failed/empty expansion keeps the original scene.
      if (targetCharsPerClip && needsEnrichment(scene.content, targetCharsPerClip)) {
        try {
          const expanded = await enrichScene(scene.content, targetCharsPerClip, lang);
          if (expanded && expanded.trim()) {
            scene.content = expanded.trim();
            wlog('scene_enriched', { episodeIndex: ep.episodeIndex, clipIndex: i, words: countWords(scene.content) });
          }
        } catch (err) {
          log(`[enrich failed] ep${ep.episodeIndex} clip${i}: ${err.message} — keeping original`);
        }
      }

      // Record a cheap local digest of this clip for within-episode continuity.
      // No LLM call here — the episode-level compression below produces the
      // summary that descendant episodes consume.
      episodeRecentDigests.push(localSceneDigest(scene, plan_clip.summary));

      // Notify caller of state update
      if (options.onState) options.onState(branchState);

      const sceneWords = countWords(scene.content);
      const sceneChoices = (scene.choices?.length || 0);
      wlog('scene_done', {
        episodeIndex: ep.episodeIndex,
        clipIndex: i,
        clipOf: totalClips,
        words: sceneWords,
        choices: sceneChoices,
        clipType: scene.clipType || plan_clip.clipType || 'NARRATIVE',
        hasConclusion: !!scene.conclusion,
      });

      episode.scenes.push(scene);
      globalClipIndex++;
    }

    // One LLM compression per episode (batched over all its clips) produces the
    // forward-carried summary descendants inherit via branchHistory. Falls back
    // to the per-clip local digests if the compression call fails.
    let episodeForwardHistory;
    try {
      episodeForwardHistory = [await compressClips(episode.scenes, lang, mode, llmFn)];
    } catch (err) {
      log(`[compression failed] ${err.message} — carrying local digests forward`);
      episodeForwardHistory = episodeRecentDigests;
    }

    // Save this episode's context snapshot for descendant episodes
    episodeContexts[ep.episodeIndex] = {
      compressedHistory: episodeForwardHistory,
      stateChanges: {
        characters: episodeCharChanges,
        items: episodeItemChanges,
        revealedIds: episodeRevealedIds,
        reinforcedForeshadowing: episodeReinforcedForeshadowing,
        resolvedForeshadowing: episodeResolvedForeshadowing,
      },
    };

    // For ending episodes, ensure the last scene has a conclusion. The
    // injected conclusion must use the server-canonical enum values (type
    // 'STORY_END', ending GOOD/NEUTRAL/SPECIAL) — same shape parseClip and
    // buildFallbackClip already emit. Earlier code emitted 'DRAMA_END' and a
    // raw CN ending label here, which the server's conclusions table accepts
    // unvalidated, leaving downstream consumers reading non-enum values.
    if (ep.isEnding) {
      const lastClip = episode.scenes[episode.scenes.length - 1];
      const fallbackEnding = VALID_ENDINGS.includes(ep.ending) ? ep.ending : '爽爆';
      if (!lastClip.conclusion) {
        log(`  Ending episode "${ep.title}" missing conclusion — injecting fallback`);
        let concTitle = ep.title;
        let concOverview = ep.clipPlan[ep.clipPlan.length - 1]?.summary || ep.title;
        // In selftell mode the injected conclusion is downstream-visible (the
        // uploader sends title/overview to the platform). Rewrite the
        // protagonist's name to "我" so the ending stays in first person.
        if (mode === 'selftell') {
          const proto = pickSelftellProtagonist(outline);
          if (proto) {
            const others = collectOtherCharacterNames(outline, proto);
            concTitle = substituteProtagonist(concTitle, proto, others);
            concOverview = substituteProtagonist(concOverview, proto, others);
          }
        }
        lastClip.conclusion = {
          title: concTitle,
          overview: concOverview,
          type: 'STORY_END',
          ending: ENDING_LABEL_TO_ENUM[fallbackEnding],
        };
        lastClip.isConclusion = true;
      }
    }

    story.episodes.push(episode);

    // Save progress after each completed episode for resume capability
    if (options.onEpisode) {
      options.onEpisode({
        episodes: story.episodes,
        episodeContexts: { ...episodeContexts },
        globalClipIndex,
      });
    }

    // Persist vector-store embeddings after each episode so a crash mid-run
    // doesn't strand the indexed clips (the caller's outer save() would
    // otherwise only fire after the whole generation completes).
    if (options.vectorStore?.save) {
      try {
        options.vectorStore.save();
      } catch (err) {
        log(`[vector store save failed] ${err.message} — indexed clips not persisted for this episode`);
        wlog('vector_store_save_failed', { episodeIndex: ep.episodeIndex, error: err.message });
      }
    }
  }

  // Validate final story
  if (!story.episodes.length) throw new Error('Story must have at least 1 episode');
  for (const ep of story.episodes) {
    if (!ep.scenes.length) throw new Error(`Episode "${ep.title}" has no scenes`);
    const hookIssues = checkHookDensity(ep);
    for (const issue of hookIssues) log(`[hook density] ${issue}`);
  }

  return story;
}
