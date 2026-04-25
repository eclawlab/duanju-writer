import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { callLLM } from './llm.js';
import { search } from './websearch.js';
import { fetchPage } from './webfetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'prompts', 'research.md');
const PROMPT_PATH_CN = join(__dirname, '..', 'prompts', 'research-cn.md');

const MAX_WEB_RESEARCH_LENGTH = 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (short TTL since sites are randomly picked)

let webResearchCache = null;
let webResearchCacheTime = 0;

function pickRandom(arr, n) {
  const copy = [...arr];
  const result = [];
  while (result.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(i, 1)[0]);
  }
  return result;
}

function getSearchQueries() {
  const year = new Date().getFullYear();
  const pool = [
    `起点中文网 热门小说 ${year}`,
    `晋江文学城 热门推荐 ${year}`,
    `纵横中文网 排行榜 ${year}`,
    `书旗小说 热门排行 ${year}`,
    `飞卢小说 热门 ${year}`,
    `最新网络小说排行榜 ${year}`,
    `Qidian trending novels ${year}`,
    `JJWXC trending novels ${year}`,
    `Zongheng popular novels ${year}`,
  ];
  return pickRandom(pool, 5);
}

function getFetchUrls() {
  const chinese = [
    'https://www.qidian.com/',                                          // CN - 起点中文网
    'https://www.qidian.com/rank/',                                     // CN - Qidian rankings
    'https://www.jjwxc.net/',                                           // CN - 晋江文学城
    'https://www.zongheng.com/rank',                                    // CN - 纵横中文网
    'https://www.shuqi.com/rank',                                       // CN - 书旗小说
    'https://www.faloo.com/',                                           // CN - 飞卢小说
  ];
  return pickRandom(chinese, 5);
}

async function fetchWebResearch() {
  const sections = [];
  let totalLength = 0;
  const searchQueries = getSearchQueries();
  const fetchUrls = getFetchUrls();

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

export async function gatherWebResearch() {
  const now = Date.now();
  if (webResearchCache && (now - webResearchCacheTime) < CACHE_TTL_MS) {
    return webResearchCache;
  }
  const result = await fetchWebResearch();
  webResearchCache = result;
  webResearchCacheTime = now;
  return result;
}

export function clearWebResearchCache() {
  webResearchCache = null;
  webResearchCacheTime = 0;
}

export function buildResearchPrompt(history, webResearch, lang = 'en', novelType = '') {
  const templateFile = lang === 'cn' ? PROMPT_PATH_CN : PROMPT_PATH;
  let template = readFileSync(templateFile, 'utf8');
  const historyText = history.length > 0
    ? history.map(h => `- ${h.topic} (${(h.genres || []).join(', ')})`).join('\n')
    : lang === 'cn' ? '（无——这是首次运行）' : '(none — this is the first run)';
  if (novelType) {
    const section = lang === 'cn'
      ? `\n\n## 小说类型要求\n\n你必须专注于以下小说类型：**${novelType}**。所有研究主题、情节灵感和角色设定都必须围绕这个类型。不要偏离此类型。\n`
      : `\n\n## Novel Type Requirement\n\nYou MUST focus exclusively on the following novel type: **${novelType}**. All research topics, plot hooks, and character ideas must be within this genre/type. Do not deviate from this type.\n`;
    template += section;
  }
  return template
    .replace('{{webResearch}}', () => webResearch || (lang === 'cn' ? '（无网络研究数据）' : '(no web research available)'))
    .replace('{{history}}', () => historyText);
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
  console.log(chalk.dim('  [json-repair] materials: primary parse failed, invoking LLM repair pass'));
  const prompt = [
    'The following text was supposed to be valid JSON but has syntax errors.',
    'Common issues: unescaped quotes, missing commas, trailing commas, unescaped newlines in strings.',
    'Fix ALL issues and return ONLY the corrected valid JSON object. No explanation, no markdown fences.',
    '',
    broken,
  ].join('\n');
  const fixed = await callLLM(prompt, 'repair');
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

// ─── News-based research ─────────────────────────────────────────────────────

const MAX_NEWS_CONTENT = 8000;

async function fetchNewsArticle(url) {
  const page = await fetchPage(url, 30_000);
  const content = (page.content || '').slice(0, MAX_NEWS_CONTENT);
  return { title: page.title || url, content, url };
}

async function extractNewsKeywords(article, lang) {
  const prompt = lang === 'cn'
    ? [
        '分析以下新闻文章，提取用于搜索相关小说素材的关键词。',
        '',
        `标题: ${article.title}`,
        `内容: ${article.content}`,
        '',
        '返回仅包含有效JSON（不要markdown，不要评论）：',
        '{"keywords": ["关键词1", "关键词2", ...], "theme": "一句话概括核心主题", "emotionalCore": "这个事件的情感内核"}',
        '',
        '提供5-8个关键词，涵盖人物、事件、地点、情感、社会议题等维度。',
      ].join('\n')
    : [
        'Analyze the following news article and extract keywords for searching related novel materials.',
        '',
        `Title: ${article.title}`,
        `Content: ${article.content}`,
        '',
        'Return ONLY valid JSON (no markdown, no commentary):',
        '{"keywords": ["keyword1", "keyword2", ...], "theme": "one-sentence core theme", "emotionalCore": "the emotional core of this event"}',
        '',
        'Provide 5-8 keywords covering people, events, places, emotions, and social issues.',
      ].join('\n');

  const raw = await callLLM(prompt, 'research');
  let data = tryParseJson(raw);
  if (!data) data = extractJsonObject(raw);
  if (!data || !Array.isArray(data.keywords)) return { keywords: [], theme: '', emotionalCore: '' };
  return data;
}

function buildNewsSearchQueries(keywords, lang) {
  const kw = keywords.keywords || [];
  const theme = keywords.theme || '';
  const queries = [];

  // Search for similar novels/fiction inspired by the news theme
  if (lang === 'cn') {
    if (theme) queries.push(`${theme} 小说`);
    for (const k of kw.slice(0, 3)) {
      queries.push(`${k} 小说 推荐`);
    }
    if (kw.length >= 2) queries.push(`${kw[0]} ${kw[1]} 网络小说`);
    // Search for more news context
    for (const k of kw.slice(0, 2)) {
      queries.push(`${k} 最新消息`);
    }
  } else {
    if (theme) queries.push(`${theme} novel`);
    for (const k of kw.slice(0, 3)) {
      queries.push(`${k} fiction book`);
    }
    if (kw.length >= 2) queries.push(`${kw[0]} ${kw[1]} web novel`);
    for (const k of kw.slice(0, 2)) {
      queries.push(`${k} latest news`);
    }
  }

  return queries.slice(0, 8);
}

async function gatherNewsResearch(newsUrl, lang) {
  const sections = [];

  // Step 1: Fetch the news article
  const article = await fetchNewsArticle(newsUrl);
  sections.push(`### Breaking News Article\nTitle: ${article.title}\nURL: ${article.url}\n\n${article.content}`);

  // Step 2: Extract keywords via LLM
  const keywords = await extractNewsKeywords(article, lang);
  sections.push(`### News Analysis\nTheme: ${keywords.theme}\nEmotional Core: ${keywords.emotionalCore}\nKeywords: ${(keywords.keywords || []).join(', ')}`);

  // Step 3: Search for more news context and similar novels
  const queries = buildNewsSearchQueries(keywords, lang);
  const searchResults = await Promise.allSettled(
    queries.map(q => search(q, 5, 15_000))
  );

  for (let i = 0; i < queries.length; i++) {
    const result = searchResults[i];
    if (result.status === 'fulfilled' && result.value.results.length > 0) {
      const items = result.value.results
        .map(r => `- ${r.title}: ${r.snippet || r.url}`)
        .join('\n');
      sections.push(`### Search: "${queries[i]}"\n${items}`);
    }
  }

  return { research: sections.join('\n\n'), keywords };
}

function buildNewsResearchPrompt(history, newsResearch, lang = 'en', novelType = '') {
  const historyText = history.length > 0
    ? history.map(h => `- ${h.topic} (${(h.genres || []).join(', ')})`).join('\n')
    : lang === 'cn' ? '（无——这是首次运行）' : '(none — this is the first run)';

  let prompt;
  if (lang === 'cn') {
    prompt = [
      '你是一位小说研究助手。你的任务是基于一条突发新闻事件，构思一个引人入胜的小说创意。',
      '',
      '## 新闻事件与相关研究',
      '',
      '以下是突发新闻原文、关键词分析、以及相关小说和新闻的搜索结果：',
      '',
      newsResearch,
      '',
      '## 指令',
      '',
      '1. 深入分析这条新闻事件：',
      '   - 事件的核心冲突和戏剧性是什么？',
      '   - 涉及哪些人物角色和他们的立场？',
      '   - 事件背后有什么深层的社会议题或人性主题？',
      '   - 这个事件最能引发读者共鸣的情感是什么？',
      '',
      '2. 基于新闻事件构思小说：',
      '   - 不要直接照搬新闻，而是以新闻为灵感进行艺术加工',
      '   - 可以改变时代背景、添加虚构元素、放大戏剧冲突',
      '   - 参考搜索到的类似小说，找到已验证受欢迎的叙事方式',
      '   - 小说类型由新闻内容自然决定（都市、悬疑、科幻等）',
      '',
      '3. 不要重复使用以下最近用过的主题：',
      historyText,
      '',
      '## 输出格式',
      '',
      '仅返回有效的JSON（不要markdown，不要评论）：',
      '',
      '```json',
      '{',
      '  "topics": [',
      '    {',
      '      "title": "简短描述性标题",',
      '      "premise": "2-3句故事设定，说明如何将新闻转化为小说",',
      '      "appeal": "为什么这个会吸引读者",',
      '      "newsInspiration": "与原始新闻事件的关联"',
      '    }',
      '  ],',
      '  "characterIdeas": [',
      '    {',
      '      "archetype": "角色类型",',
      '      "twist": "这个角色的新颖之处"',
      '    }',
      '  ],',
      '  "plotHooks": [',
      '    "一句话情节钩子，制造即时紧张感"',
      '  ],',
      '  "genres": ["类型1", "类型2"],',
      '  "fandom": null,',
      '  "sources": ["你参考的网址或来源"]',
      '}',
      '```',
      '',
      '提供至少3个主题（都基于同一新闻但采用不同角度/类型）、3个角色创意和5个情节钩子。所有内容必须用中文撰写。',
    ].join('\n');
  } else {
    prompt = [
      'You are a fiction research assistant. Your job is to craft compelling novel ideas inspired by a breaking news event.',
      '',
      '## Breaking News & Related Research',
      '',
      'Below is the original news article, keyword analysis, and search results for related novels and news:',
      '',
      newsResearch,
      '',
      '## Instructions',
      '',
      '1. Deeply analyze this news event:',
      '   - What is the core conflict and dramatic tension?',
      '   - Who are the key figures and what are their stakes?',
      '   - What deeper social issues or human themes lie beneath?',
      '   - What emotions will resonate most with readers?',
      '',
      '2. Craft novel ideas based on the news:',
      '   - Do NOT retell the news literally — use it as creative inspiration',
      '   - You may change the setting, add fictional elements, amplify dramatic conflict',
      '   - Reference similar novels from search results for proven narrative approaches',
      '   - Let the novel genre emerge naturally from the news content (thriller, sci-fi, drama, etc.)',
      '',
      '3. DO NOT reuse any of these recently used topics:',
      historyText,
      '',
      '## Output Format',
      '',
      'Return ONLY valid JSON (no markdown, no commentary):',
      '',
      '```json',
      '{',
      '  "topics": [',
      '    {',
      '      "title": "Short descriptive title",',
      '      "premise": "2-3 sentence story premise explaining how the news is transformed into fiction",',
      '      "appeal": "Why this would attract readers",',
      '      "newsInspiration": "Connection to the original news event"',
      '    }',
      '  ],',
      '  "characterIdeas": [',
      '    {',
      '      "archetype": "Character type",',
      '      "twist": "What makes this character fresh"',
      '    }',
      '  ],',
      '  "plotHooks": [',
      '    "One-sentence plot hook that creates immediate tension"',
      '  ],',
      '  "genres": ["genre1", "genre2"],',
      '  "fandom": null,',
      '  "sources": ["URLs or references you consulted"]',
      '}',
      '```',
      '',
      'Provide at least 3 topics (all based on the same news but from different angles/genres), 3 character ideas, and 5 plot hooks.',
    ].join('\n');
  }

  if (novelType) {
    const section = lang === 'cn'
      ? `\n\n## 小说类型要求\n\n你必须专注于以下小说类型：**${novelType}**。所有研究主题、情节灵感和角色设定都必须围绕这个类型。不要偏离此类型。\n`
      : `\n\n## Novel Type Requirement\n\nYou MUST focus exclusively on the following novel type: **${novelType}**. All research topics, plot hooks, and character ideas must be within this genre/type. Do not deviate from this type.\n`;
    prompt += section;
  }

  return prompt;
}

export async function collect(history, options = {}) {
  const lang = options.lang || 'en';
  const novelType = options.novelType || '';
  const newsUrl = options.newsUrl || '';

  if (newsUrl) {
    // News-based collection: fetch article, extract keywords, search for context & similar novels
    const { research, keywords } = await gatherNewsResearch(newsUrl, lang);
    const prompt = buildNewsResearchPrompt(history, research, lang, novelType);
    const raw = await callLLM(prompt, 'research');
    const materials = await parseMaterials(raw);
    // Attach news metadata so downstream steps have context
    materials.newsSource = { url: newsUrl, theme: keywords.theme, emotionalCore: keywords.emotionalCore };
    return materials;
  }

  const webResearch = await gatherWebResearch();
  const prompt = buildResearchPrompt(history, webResearch, lang, novelType);
  const raw = await callLLM(prompt, 'research');
  return await parseMaterials(raw);
}
