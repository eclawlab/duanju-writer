import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', 'prompts', 'snowflake.md');
const TEMPLATE_PATH_CN = join(__dirname, '..', 'prompts', 'snowflake-cn.md');

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

export function buildSnowflakePrompt(materials, partIndex, priorParts, lang = 'en') {
  const templateFile = lang === 'cn' ? TEMPLATE_PATH_CN : TEMPLATE_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const part = PARTS[partIndex];

  template = template.replace('{{materials}}', JSON.stringify(materials, null, 2));
  template = template.replace('{{partNumber}}', String(partIndex + 1));
  template = template.replace('{{partTitle}}', part.title);

  let instructions = part.instructions;
  if (priorParts.length > 0) {
    instructions = 'Previous parts for context:\n' + JSON.stringify(priorParts, null, 2) + '\n\n' + instructions;
  }
  template = template.replace('{{partInstructions}}', instructions);

  return template;
}

export async function generateSnowflake(materials, options = {}) {
  const lang = options.lang || 'en';
  const log = options.log || (() => {});
  const parts = [];

  for (let i = 0; i < PARTS.length; i++) {
    log(`Snowflake step ${i + 1}/4: ${PARTS[i].title}...`);
    const prompt = buildSnowflakePrompt(materials, i, parts, lang);
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
