import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude } from './claude.js';
import { search } from './websearch.js';
import { fetchPage } from './webfetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'prompts', 'research.md');
const PROMPT_PATH_CN = join(__dirname, '..', 'prompts', 'research-cn.md');

const MAX_WEB_RESEARCH_LENGTH = 10_000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let webResearchCache = null;
let webResearchCacheTime = 0;
let webResearchCacheLang = null;

function getSearchQueries(lang) {
  const year = new Date().getFullYear();
  const base = [
    `Reddit WritingPrompts best this week`,
    `Royal Road best rated fiction`,
  ];
  if (lang === 'cn') {
    return [
      `起点中文网 热门小说 ${year}`,
      `晋江文学城 热门推荐 ${year}`,
      `最新网络小说排行榜 ${year}`,
      ...base,
    ];
  }
  return [
    `trending stories Wattpad ${year}`,
    `popular web novels qidian ${year}`,
    `jjwxc trending novels ${year}`,
    ...base,
  ];
}

function getFetchUrls(lang) {
  const base = [
    'https://www.wattpad.com/stories/trending',
    'https://old.reddit.com/r/WritingPrompts/top/?t=week',
  ];
  if (lang === 'cn') {
    return [
      'https://www.jjwxc.net/',
      'https://www.qidian.com/',
      'https://www.qidian.com/rank/',
      ...base,
    ];
  }
  return [
    'https://www.jjwxc.net/',
    'https://www.qidian.com/',
    ...base,
  ];
}

async function fetchWebResearch(lang) {
  const sections = [];
  let totalLength = 0;
  const searchQueries = getSearchQueries(lang);
  const fetchUrls = getFetchUrls(lang);

  // Run searches
  const searchResults = await Promise.allSettled(
    searchQueries.map(q => search(q, 5, 15_000))
  );

  for (let i = 0; i < searchQueries.length; i++) {
    if (totalLength >= MAX_WEB_RESEARCH_LENGTH) break;
    const result = searchResults[i];
    if (result.status === 'fulfilled' && result.value.results.length > 0) {
      const items = result.value.results
        .map(r => `- ${r.title}: ${r.snippet || r.url}`)
        .join('\n');
      const section = `### Search: "${searchQueries[i]}"\n${items}`;
      sections.push(section);
      totalLength += section.length;
    }
  }

  // Fetch pages
  const fetchResults = await Promise.allSettled(
    fetchUrls.map(url => fetchPage(url, 30_000))
  );

  for (let i = 0; i < fetchUrls.length; i++) {
    if (totalLength >= MAX_WEB_RESEARCH_LENGTH) break;
    const result = fetchResults[i];
    if (result.status === 'fulfilled' && result.value.content) {
      const budget = Math.min(2000, MAX_WEB_RESEARCH_LENGTH - totalLength);
      if (budget <= 0) break;
      const content = result.value.content.slice(0, budget);
      const title = result.value.title || fetchUrls[i];
      const section = `### Page: ${title} (${fetchUrls[i]})\n${content}`;
      sections.push(section);
      totalLength += section.length;
    }
  }

  if (sections.length === 0) {
    return '(Web research unavailable — all requests failed)';
  }

  return sections.join('\n\n');
}

export async function gatherWebResearch(lang = 'en') {
  const now = Date.now();
  if (webResearchCache && webResearchCacheLang === lang && (now - webResearchCacheTime) < CACHE_TTL_MS) {
    return webResearchCache;
  }
  const result = await fetchWebResearch(lang);
  webResearchCache = result;
  webResearchCacheTime = now;
  webResearchCacheLang = lang;
  return result;
}

export function clearWebResearchCache() {
  webResearchCache = null;
  webResearchCacheTime = 0;
  webResearchCacheLang = null;
}

export function buildResearchPrompt(history, webResearch, lang = 'en') {
  const templateFile = lang === 'cn' ? PROMPT_PATH_CN : PROMPT_PATH;
  const template = readFileSync(templateFile, 'utf8');
  const historyText = history.length > 0
    ? history.map(h => `- ${h.topic} (${(h.genres || []).join(', ')})`).join('\n')
    : lang === 'cn' ? '（无——这是首次运行）' : '(none — this is the first run)';
  return template
    .replace('{{webResearch}}', webResearch || (lang === 'cn' ? '（无网络研究数据）' : '(no web research available)'))
    .replace('{{history}}', historyText);
}

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

function tryParseJson(raw) {
  const cleaned = cleanRaw(raw);
  try { return JSON.parse(cleaned); } catch {}
  const extracted = extractJsonObject(cleaned);
  if (extracted) return extracted;
  return null;
}

async function repairJson(broken) {
  const prompt = [
    'The following text was supposed to be valid JSON but has syntax errors.',
    'Common issues: unescaped quotes, missing commas, trailing commas, unescaped newlines in strings.',
    'Fix ALL issues and return ONLY the corrected valid JSON object. No explanation, no markdown fences.',
    '',
    broken,
  ].join('\n');
  const fixed = await callClaude(prompt);
  const result = tryParseJson(fixed);
  if (result) return result;
  const extracted = extractJsonObject(fixed);
  if (extracted) return extracted;
  throw new Error('Failed to parse materials JSON even after LLM repair');
}

export async function parseMaterials(raw) {
  let data = tryParseJson(raw);
  if (!data) {
    data = await repairJson(cleanRaw(raw));
  }

  if (!data.topics || !Array.isArray(data.topics)) {
    throw new Error('Missing topics array');
  }
  if (!data.plotHooks || !Array.isArray(data.plotHooks)) {
    throw new Error('Missing plotHooks array');
  }
  return data;
}

export async function collect(history, options = {}) {
  const lang = options.lang || 'en';
  const webResearch = await gatherWebResearch(lang);
  const prompt = buildResearchPrompt(history, webResearch, lang);
  const raw = await callClaude(prompt);
  return await parseMaterials(raw);
}
