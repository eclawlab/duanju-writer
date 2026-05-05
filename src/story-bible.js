import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHUNK_SIZE = 3000;

const HEADING_PATTERNS = [
  { kind: 'cn-chapter', re: /^[ \t]*#{0,6}[ \t]*第[0-9一二三四五六七八九十百千零〇两]+[章节](?=$|[ \t])[ \t]*([^\n]*)$/gm },
  { kind: 'en-chapter', re: /^[ \t]*#{0,6}[ \t]*Chapter[ \t]+\d+(?:[ \t.:—-]+([^\n]*))?[ \t]*$/gim },
  { kind: 'numeric', re: /^[ \t]*#{0,6}[ \t]*(?:\d+\.|[一二三四五六七八九十百]+、)[ \t]*([^\n]*)$/gm },
];

export function splitChapters(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error('splitChapters: input is empty');
  }
  for (const pat of HEADING_PATTERNS) {
    const matches = [...rawText.matchAll(pat.re)];
    if (matches.length >= 1) {
      return matchesToChapters(rawText, matches);
    }
  }
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
