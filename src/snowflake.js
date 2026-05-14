import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from './llm.js';
import { buildBibleBlock } from './story-bible.js';
import { buildSelftellDirective } from './selftell.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', 'prompts', 'snowflake.md');

const PARTS = [
  {
    title: 'Core Seed',
    instructions: 'Generate a one-sentence story essence capturing: protagonist, core event, key action, and hidden crisis.\n\nReturn: {"coreSeed": "One sentence story essence"}',
  },
  {
    title: 'Character Dynamics',
    instructions: 'Design 3-6 complex characters based on the core seed.\n\nFor each character provide:\n- name, role, background\n- motivation: { surface (material goal), deep (emotional need), soul (philosophical layer) }\n- arc: { initial, trigger, dissonance, transformation, final }\n- secrets: hidden weaknesses or betrayal potential\n\nReturn: {"characters": [{"name":"...","role":"...","background":"...","motivation":{"surface":"...","deep":"...","soul":"..."},"arc":{"initial":"...","trigger":"...","dissonance":"...","transformation":"...","final":"..."},"secrets":["..."]}]}',
  },
  {
    title: 'World Building',
    instructions: 'Design the story world in three dimensions based on the core seed and characters.\n\n1. Physical: geography, time period, system rules (physics/magic/social) with exploitable loopholes\n2. Social: power structures, cultural taboos, economic pressures\n3. Symbolic: recurring visual symbols, climate/environment mapping to psychological states\n\nReturn: {"world":{"physical":{"geography":"...","timePeriod":"...","rules":"...","loopholes":"..."},"social":{"powerStructure":"...","taboos":"...","economics":"..."},"symbolic":{"symbols":["..."],"climateMood":"...","architectureTheme":"..."}}}',
  },
  {
    title: 'Plot Architecture',
    instructions: 'Design a three-act plot structure.\n\nAct 1 (Trigger): catalyst event, protagonist\'s mistaken reaction, stakes established\nAct 2 (Confrontation): escalation, dual pressure, false victory, darkest moment revelation\nAct 3 (Resolution): cost revealed, plot twist(s), resolution with open epilogue possibility\n\nReturn: {"plot":{"act1":{"catalyst":"...","reaction":"...","stakes":"..."},"act2":{"escalation":"...","pressure":"...","falseVictory":"...","darkestMoment":"..."},"act3":{"cost":"...","twist":"...","resolution":"...","epilogue":"..."}}}',
  },
];

const PARTS_CN = [
  {
    title: '核心种子',
    instructions: '生成一句话故事精髓，涵盖：主角、核心事件、关键行动、隐藏的危机。\n\n返回：{"coreSeed": "一句话故事精髓"}',
  },
  {
    title: '人物动力',
    instructions: '基于核心种子设计 3-6 位复杂角色。\n\n每位角色需包含：\n- name（姓名）、role（角色定位）、background（背景）\n- motivation（动机）：{ surface（表层物质目标）、deep（深层情感需求）、soul（灵魂层面的哲学追求）}\n- arc（人物弧光）：{ initial（初始状态）、trigger（触发点）、dissonance（内心挣扎）、transformation（蜕变）、final（终局）}\n- secrets（秘密）：隐藏的弱点或潜在的背叛可能\n\n返回：{"characters": [{"name":"...","role":"...","background":"...","motivation":{"surface":"...","deep":"...","soul":"..."},"arc":{"initial":"...","trigger":"...","dissonance":"...","transformation":"...","final":"..."},"secrets":["..."]}]}',
  },
  {
    title: '世界观构建',
    instructions: '基于核心种子与人物，从三个维度设计故事世界。\n\n1. 物理（physical）：地理、时代、体系规则（物理/魔法/社会）及可利用的漏洞\n2. 社会（social）：权力结构、文化禁忌、经济压力\n3. 象征（symbolic）：反复出现的视觉符号、气候/环境与心理状态的映射\n\n返回：{"world":{"physical":{"geography":"...","timePeriod":"...","rules":"...","loopholes":"..."},"social":{"powerStructure":"...","taboos":"...","economics":"..."},"symbolic":{"symbols":["..."],"climateMood":"...","architectureTheme":"..."}}}',
  },
  {
    title: '情节架构',
    instructions: '设计三幕式情节结构。\n\n第一幕（触发）：催化事件、主角的错误反应、确立赌注\n第二幕（对抗）：升级、双重压力、虚假胜利、最黑暗时刻的揭示\n第三幕（解决）：代价揭露、情节反转、带有开放式尾声可能的解决\n\n返回：{"plot":{"act1":{"catalyst":"...","reaction":"...","stakes":"..."},"act2":{"escalation":"...","pressure":"...","falseVictory":"...","darkestMoment":"..."},"act3":{"cost":"...","twist":"...","resolution":"...","epilogue":"..."}}}',
  },
];

export function buildSnowflakePrompt(materials, partIndex, priorParts, lang = 'cn', genre = '', referenceCharacter = '', referenceEvent = '', options = {}) {
  let template = readFileSync(TEMPLATE_PATH, 'utf8');
  const parts = lang === 'cn' ? PARTS_CN : PARTS;
  const part = parts[partIndex];

  template = template.replace('{{materials}}', () => JSON.stringify(materials, null, 2));
  template = template.replace('{{partNumber}}', () => String(partIndex + 1));
  template = template.replace('{{partTitle}}', () => part.title);

  let instructions = part.instructions;
  if (priorParts.length > 0) {
    instructions = 'Previous parts for context:\n' + JSON.stringify(priorParts, null, 2) + '\n\n' + instructions;
  }
  if (genre) {
    const constraint = lang === 'cn'
      ? `\n\n重要：这个故事必须是**${genre}**类型。所有角色、世界观、情节都必须符合此类型。`
      : `\n\nIMPORTANT: This story MUST be a **${genre}** novel. All characters, world-building, and plot must align with this genre/type.`;
    instructions += constraint;
  }
  if (referenceCharacter) {
    // Character dynamics step (index 1) needs the strongest injection — the model must use this character verbatim rather than invent one.
    const isCharStep = partIndex === 1;
    const block = lang === 'cn'
      ? `\n\n## 参考角色（必须使用）\n\n本故事必须包含以下预先定义的角色。请完整保留该角色的姓名、身份、性格、背景、动机与弧光；可在其周围虚构其他角色。${isCharStep ? '在本步骤的 characters 数组中，必须将此角色作为其中一项（按所需的 motivation/arc/secrets 结构填充），不得替换姓名或身份。' : ''}\n\n---\n${referenceCharacter}\n---\n`
      : `\n\n## Reference Character (REQUIRED)\n\nThis story MUST feature the following predefined character. Preserve their name, identity, traits, background, motivations, and arc exactly as described. Other characters may be invented around them.${isCharStep ? ' In this step\'s characters array, include this character as one of the entries (fill in the required motivation/arc/secrets structure) — do NOT rename or replace them.' : ''}\n\n---\n${referenceCharacter}\n---\n`;
    instructions += block;
  }
  if (referenceEvent) {
    // Plot architecture step (index 3) needs the strongest injection — the event must be load-bearing in the plot structure.
    const isPlotStep = partIndex === 3;
    const block = lang === 'cn'
      ? `\n\n## 参考事件（必须使用）\n\n本故事必须围绕以下预定义事件展开。请完整保留该事件的事实、情感分量与后果；不要淡化或偏离。${isPlotStep ? '在本步骤的三幕式结构中，必须将此事件作为核心承重节点（催化事件、升级点或最黑暗时刻的揭示），不得用其他情节替代。' : ''}\n\n---\n${referenceEvent}\n---\n`
      : `\n\n## Reference Event (REQUIRED)\n\nThis story MUST be built around the following predefined event. Preserve its facts, emotional weight, and consequences — do not sanitize, dilute, or drift from it.${isPlotStep ? ' In this step\'s three-act structure, this event MUST be a load-bearing beat (catalyst, escalation point, or darkest-moment revelation) — do NOT substitute a different plot beat.' : ''}\n\n---\n${referenceEvent}\n---\n`;
    instructions += block;
  }
  if (materials.newsSource) {
    const ns = materials.newsSource;
    const newsNote = lang === 'cn'
      ? `\n\n新闻灵感：本故事基于真实新闻事件创作。主题：${ns.theme}。情感内核：${ns.emotionalCore}。不要照搬新闻，而是以此为灵感进行艺术加工。`
      : `\n\nNews Inspiration: This story is inspired by a real news event. Theme: ${ns.theme}. Emotional core: ${ns.emotionalCore}. Do NOT retell the news — use it as creative inspiration.`;
    instructions += newsNote;
  }
  if (options.bible && options.fidelity) {
    instructions += '\n\n' + buildBibleBlock(options.bible, options.fidelity);
  }
  if (options.mode === 'selftell') {
    instructions += '\n\n' + buildSelftellDirective(lang, 'snowflake');
  }
  template = template.replace('{{partInstructions}}', () => instructions);

  return template;
}

export async function generateSnowflake(materials, options = {}) {
  const lang = options.lang || 'cn';
  const genre = options.genre || '';
  const referenceCharacter = options.referenceCharacter || '';
  const referenceEvent = options.referenceEvent || '';
  const bible = options.bible || null;
  const fidelity = options.fidelity || null;
  const mode = options.mode || 'default';
  const log = options.log || (() => {});
  const parts = [];
  const localized = lang === 'cn' ? PARTS_CN : PARTS;

  for (let i = 0; i < localized.length; i++) {
    log(`Snowflake step ${i + 1}/${localized.length}: ${localized[i].title}...`);
    const prompt = buildSnowflakePrompt(materials, i, parts, lang, genre, referenceCharacter, referenceEvent, { bible, fidelity, mode });
    const raw = await callLLM(prompt, 'outline');
    // Try to parse JSON, fall back to raw text
    try {
      const cleaned = raw.trim().replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
      parts.push(JSON.parse(cleaned));
    } catch {
      // Try extracting JSON object
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { parts.push(JSON.parse(raw.slice(start, end + 1))); }
        catch { parts.push({ raw: raw }); }
      } else {
        parts.push({ raw: raw });
      }
    }
  }

  return {
    coreSeed: parts[0]?.coreSeed || parts[0]?.raw || '',
    characters: parts[1]?.characters || [],
    world: parts[2]?.world || {},
    plot: parts[3]?.plot || {},
  };
}

export { PARTS };
