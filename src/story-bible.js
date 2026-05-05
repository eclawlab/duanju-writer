import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLLM as defaultCallLLM } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'prompts', 'story-bible.md');

const CHUNK_SIZE = 3000;

const HEADING_PATTERNS = [
  { kind: 'cn-chapter', re: /^[ \t]*#{0,6}[ \t]*第[0-9一二三四五六七八九十百千零〇两]+[章节](?=$|[ \t])[ \t]*([^\n]*)$/gm },
  { kind: 'en-chapter', re: /^[ \t]*#{0,6}[ \t]*Chapter[ \t]+\d+(?:[ \t.:—-]+([^\n]*))?[ \t]*$/gim },
  { kind: 'numeric', re: /^[ \t]*#{0,6}[ \t]*(?:\d+\.|[一二三四五六七八九十百]+、)[ \t]*([^\n]*)$/gm },
];

export function splitChapters(rawText, opts = {}) {
  const log = opts.log || (() => {});
  if (!rawText || !rawText.trim()) {
    throw new Error('splitChapters: input is empty');
  }
  for (const pat of HEADING_PATTERNS) {
    const matches = [...rawText.matchAll(pat.re)];
    if (matches.length >= 1) {
      return matchesToChapters(rawText, matches);
    }
  }
  log(`[splitChapters] no chapter headings detected — falling back to ${CHUNK_SIZE}-char windows. tight-fidelity coverage semantics will be over arbitrary windows, not real chapters.`);
  return windowedChunks(rawText);
}

function matchesToChapters(rawText, matches) {
  const chapters = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headingEnd = m.index + m[0].length;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const prose = rawText.slice(headingEnd, nextStart).trim();
    chapters.push({
      chapterIndex: i + 1,
      title: (m[1] || '').trim(),
      prose,
    });
  }
  return chapters;
}

function windowedChunks(rawText) {
  const out = [];
  let pos = 0;
  let idx = 1;
  while (pos < rawText.length) {
    const slice = rawText.slice(pos, pos + CHUNK_SIZE);
    out.push({ chapterIndex: idx, title: '', prose: slice });
    pos += CHUNK_SIZE;
    idx += 1;
  }
  return out;
}

// ─── Bible compression ────────────────────────────────────────────────────────

export function compressBibleForEpisode(bible, range) {
  const [start, end] = range;
  const characters = bible.characters.filter((c) => {
    if (c.role === 'reference-pinned') return true;
    const cs = c.firstChapter ?? 1;
    const ce = c.lastChapter ?? cs;
    return ce >= start && cs <= end;
  });
  const events = bible.events.filter((e) => {
    const [es, ee] = e.chapterRange ?? [0, 0];
    return ee >= start && es <= end;
  });
  const hooks = (bible.hooks ?? []).filter((h) => {
    const [hs, he] = h.chapterRange ?? [0, 0];
    return he >= start && hs <= end;
  });
  return {
    schemaVersion: bible.schemaVersion,
    title: bible.title,
    logline: bible.logline,
    characters,
    events,
    hooks,
    themes: bible.themes,
    world: bible.world,
    ending: bible.ending,
  };
}

// ─── Chapter prose selection ──────────────────────────────────────────────────

export function selectChapterProse(chapters, range, budgetChars) {
  const [start, end] = range;
  const slice = chapters.filter((c) => c.chapterIndex >= start && c.chapterIndex <= end);
  if (slice.length === 0) return '';
  const blocks = slice.map((c) => `【章节 ${c.chapterIndex}：${c.title}】\n${c.prose}`);
  const full = blocks.join('\n\n');
  if (full.length <= budgetChars) return full;
  const halfBudget = Math.floor((budgetChars - 30) / 2);
  const omitted = full.length - 2 * halfBudget;
  return `${full.slice(0, halfBudget)}\n…[省略 ${omitted} 字]…\n${full.slice(-halfBudget)}`;
}

// ─── Artifact I/O ─────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

export function saveStoryArtifacts(jobDir, { bible, chapters }) {
  const storyDir = join(jobDir, 'story');
  if (!existsSync(storyDir)) mkdirSync(storyDir, { recursive: true });
  writeFileSync(join(storyDir, 'bible.json'), JSON.stringify(bible, null, 2));
  writeFileSync(join(storyDir, 'chapters.json'), JSON.stringify(chapters, null, 2));
}

export function loadStoryArtifacts(jobDir) {
  const biblePath = join(jobDir, 'story', 'bible.json');
  const chaptersPath = join(jobDir, 'story', 'chapters.json');
  if (!existsSync(biblePath) || !existsSync(chaptersPath)) return null;
  let bible, chapters;
  try {
    bible = JSON.parse(readFileSync(biblePath, 'utf8'));
    chapters = JSON.parse(readFileSync(chaptersPath, 'utf8'));
  } catch {
    return null;
  }
  if (bible.schemaVersion !== SCHEMA_VERSION) return null;
  if (chapters.schemaVersion !== SCHEMA_VERSION) return null;
  return { bible, chapters };
}

// ─── LLM extraction ───────────────────────────────────────────────────────────

function loadPromptSection(name) {
  const tpl = readFileSync(PROMPT_PATH, 'utf8');
  const re = new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
  const m = tpl.match(re);
  if (!m) throw new Error(`story-bible.md: section "${name}" not found`);
  return m[1].trim();
}

function cleanJson(raw) {
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  return s;
}

export async function extractChapterFacts(chapter, opts = {}) {
  const llmFn = opts.llmFn || defaultCallLLM;
  const role = opts.role || 'research';
  const section = loadPromptSection('Per-Chapter Extraction');
  const prompt = `${section}\n\n## 输入\n\n章节编号：${chapter.chapterIndex}\n章节标题：${chapter.title || '(无)'}\n\n${chapter.prose}`;
  const raw = await llmFn(prompt, role);
  const cleaned = cleanJson(raw);
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (err) { throw new Error(`extractChapterFacts: failed to parse JSON: ${err.message}`); }
  return { ...parsed, chapterIndex: chapter.chapterIndex };
}

export async function synthesizeBible(chapterFacts, opts = {}) {
  const llmFn = opts.llmFn || defaultCallLLM;
  const role = opts.role || 'outline';
  const sourceTitle = opts.sourceTitle || '';
  const section = loadPromptSection('Synthesis');
  const prompt = `${section}\n\n## 输入\n\n源标题：${sourceTitle}\n\nChapterFacts JSON：\n${JSON.stringify(chapterFacts, null, 2)}`;
  const raw = await llmFn(prompt, role);
  const cleaned = cleanJson(raw);
  let bible;
  try { bible = JSON.parse(cleaned); }
  catch (err) { throw new Error(`synthesizeBible: failed to parse JSON: ${err.message}`); }
  if (!Array.isArray(bible.characters) || bible.characters.length === 0) {
    throw new Error('synthesizeBible: bible has 0 characters — input may not be narrative');
  }
  if (!Array.isArray(bible.events) || bible.events.length === 0) {
    throw new Error('synthesizeBible: bible has 0 events — input may not be narrative');
  }
  return { schemaVersion: SCHEMA_VERSION, ...bible };
}

// ─── Prompt block builders ────────────────────────────────────────────────────

const FIDELITY_NOTES = {
  tight:  '雪花/大纲/规划/片段必须严格反映上述事件顺序与人物弧光，禁止改名、换设定或重排时序。',
  medium: '可在保留核心冲突与主要人物弧光的前提下，压缩或合并相邻事件以适配短剧节奏。',
  loose:  '上述内容仅作灵感来源，可大幅改编情节与人物。',
};

export function buildBibleBlock(bible, fidelity) {
  if (!FIDELITY_NOTES[fidelity]) {
    throw new Error(`buildBibleBlock: unknown fidelity "${fidelity}", expected tight|medium|loose`);
  }
  const charLines = (bible.characters || []).map(c =>
    `- ${c.name}（${c.role}）：${c.identity} | 动机：${c.motivation}${c.arc ? ' | 弧光：' + c.arc : ''}`
  ).join('\n');
  const eventLines = (bible.events || []).map(e =>
    `${(e.eventIndex ?? '?')}. [章 ${e.chapterRange?.[0]}-${e.chapterRange?.[1]}] ${e.summary}${e.isTurningPoint ? ' ⚡转折' : ''}${e.isReveal ? ' 💡揭示' : ''}`
  ).join('\n');
  const themes = (bible.themes || []).join('、');
  // Defensive coerce: synthesizeBible's prompt asks for world as a string,
  // but a structured object (e.g. snowflake-style { physical, social, ... })
  // would otherwise interpolate as "[object Object]" into every prompt.
  const world = typeof bible.world === 'string' ? bible.world : JSON.stringify(bible.world ?? '');
  return [
    '## 参考小说（必须遵循）',
    '本剧改编自下列小说。Logline、人物、事件、主题已抽取如下。',
    '',
    `【Logline】${bible.logline}`,
    '【人物】',
    charLines,
    '【事件（按时序）】',
    eventLines,
    `【主题】${themes}`,
    `【世界观】${world}`,
    `【原结局】${bible.ending}`,
    '',
    `Fidelity = ${fidelity}.`,
    `- ${fidelity}: ${FIDELITY_NOTES[fidelity]}`,
  ].join('\n');
}

export function buildProseBlock(chapters, range, fidelity, budgetChars) {
  if (fidelity === 'loose') return '';
  if (!range) return '';
  const prose = selectChapterProse(chapters, range, budgetChars);
  if (!prose) return '';
  return [
    '## 原文片段（参考用语与细节）',
    '以下为本集对应的原文章节内容（节选）。请在保持短剧节奏（钩点、字数限制）的前提下，',
    '借鉴其用词、画面感、人物语气，使台词与动作更具体、更生动。',
    '不得逐字抄录超过 20 字的段落。',
    '',
    prose,
  ].join('\n');
}
