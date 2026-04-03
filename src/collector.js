import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
let webResearchCacheLang = null;

function pickRandom(arr, n) {
  const copy = [...arr];
  const result = [];
  while (result.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(i, 1)[0]);
  }
  return result;
}

function getSearchQueries(lang) {
  const year = new Date().getFullYear();

  // Universal search queries (work for any language via DuckDuckGo)
  const universal = [
    `Reddit WritingPrompts best this week`,
    `Royal Road best rated fiction ${year}`,
    `Goodreads most popular novels ${year}`,
    `Novel Updates top ranked series ${year}`,
  ];

  let pool;
  if (lang === 'cn') {
    pool = [
      // Chinese platforms
      `起点中文网 热门小说 ${year}`,
      `晋江文学城 热门推荐 ${year}`,
      `纵横中文网 排行榜 ${year}`,
      `书旗小说 热门排行 ${year}`,
      `飞卢小说 热门 ${year}`,
      `最新网络小说排行榜 ${year}`,
      // Japanese platforms (popular in CN market)
      `小説家になろう ランキング ${year}`,
      `カクヨム 人気 ${year}`,
      // Korean platforms
      `카카오페이지 인기 웹소설 ${year}`,
      `노벨피아 인기 소설 ${year}`,
      ...universal,
    ];
  } else {
    pool = [
      // English platforms
      `trending stories Wattpad ${year}`,
      `popular web novels Webnovel ${year}`,
      `Scribblehub top rated novels ${year}`,
      `Tapas popular novels ${year}`,
      `Archive of Our Own popular fanfics ${year}`,
      `Dreame popular stories ${year}`,
      `NovelToon trending stories ${year}`,
      `Quotev popular stories ${year}`,
      // Chinese platforms
      `Qidian trending novels ${year}`,
      `JJWXC trending novels ${year}`,
      `Zongheng popular novels ${year}`,
      // Japanese platforms
      `Syosetu Narou top novels ${year}`,
      `Kakuyomu popular web novels ${year}`,
      `Alphapolis novel ranking ${year}`,
      // Korean platforms
      `KakaoPage popular web novels ${year}`,
      `Novelpia top Korean web novels ${year}`,
      `Joara best Korean novels ${year}`,
      // Vietnamese / Indian / Other
      `TruyenFull truyen hot ${year}`,
      `Pratilipi trending stories India ${year}`,
      ...universal,
    ];
  }

  return pickRandom(pool, 5);
}

function getFetchUrls(lang) {
  // Sites verified accessible via direct fetch
  const global = [
    'https://www.wattpad.com/stories/trending',                        // EN - Global fiction
    'https://old.reddit.com/r/WritingPrompts/top/?t=week',             // EN - Writing prompts
    'https://tapas.io/novels',                                          // EN - Serialized novels
    'https://www.goodreads.com/list/show/1.Best_Books_Ever',           // EN - Book rankings
    'https://www.quotev.com/stories',                                   // EN - User stories
    'https://dreame.com/ranking',                                       // EN - Romance/fiction
    'https://noveltoon.mobi/en/ranking/all',                            // EN - Global novels
    'https://www.novelupdates.com/',                                    // EN - Asian novel translations
  ];

  const chinese = [
    'https://www.qidian.com/',                                          // CN - 起点中文网
    'https://www.qidian.com/rank/',                                     // CN - Qidian rankings
    'https://www.jjwxc.net/',                                           // CN - 晋江文学城
    'https://www.zongheng.com/rank',                                    // CN - 纵横中文网
    'https://www.shuqi.com/rank',                                       // CN - 书旗小说
    'https://www.faloo.com/',                                           // CN - 飞卢小说
  ];

  const japanese = [
    'https://www.syosetu.com/',                                         // JP - 小説家になろう
    'https://yomou.syosetu.com/rank/list/type/daily_total/',            // JP - Syosetu daily ranking
    'https://kakuyomu.jp/',                                             // JP - カクヨム
    'https://www.alphapolis.co.jp/novel/ranking/annual',                // JP - アルファポリス
    'https://www.pixiv.net/novel/ranking.php',                          // JP - Pixiv novels
  ];

  const korean = [
    'https://page.kakao.com/menu/10011/screen/70',                     // KR - 카카오페이지
    'https://novelpia.com/proc/ranking_list',                           // KR - 노벨피아
    'https://www.joara.com/best',                                       // KR - 조아라
    'https://ridibooks.com/category/books/2200',                        // KR - 리디북스
  ];

  const other = [
    'https://truyenfull.vision/danh-sach/truyen-hot/',                  // VN - Vietnamese novels
    'https://www.pratilipi.com/trending',                                // IN - Indian multi-language
  ];

  // Sites that may need browser-like access (included as best-effort)
  const bestEffort = [
    'https://www.royalroad.com/fictions/best-rated',                    // EN - Web fiction
    'https://archiveofourown.org/works',                                // EN - Fanfiction (AO3)
    'https://www.webnovel.com/ranking/novel',                           // EN - Qidian International
    'https://www.scribblehub.com/series-ranking/',                      // EN - Web novels
  ];

  if (lang === 'cn') {
    // CN mode: pick 2 from Chinese, 1 from Japanese, 1 from Korean, 1 from the rest
    return [
      ...pickRandom(chinese, 2),
      ...pickRandom(japanese, 1),
      ...pickRandom(korean, 1),
      ...pickRandom([...global, ...other, ...bestEffort], 1),
    ];
  }
  // EN mode: pick 2 from global, 1 from Chinese, 1 from Japanese/Korean, 1 from best-effort/other
  return [
    ...pickRandom(global, 2),
    ...pickRandom(chinese, 1),
    ...pickRandom([...japanese, ...korean], 1),
    ...pickRandom([...other, ...bestEffort], 1),
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

export async function collect(history, options = {}) {
  const lang = options.lang || 'en';
  const webResearch = await gatherWebResearch(lang);
  const prompt = buildResearchPrompt(history, webResearch, lang);
  const raw = await callLLM(prompt, 'research');
  return await parseMaterials(raw);
}
