import { decodeHtmlEntities, stripHtmlTags } from './html.js';

// Re-exported so existing importers/tests can keep pulling these from websearch.
export { decodeHtmlEntities, stripHtmlTags };

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export async function search(query, maxResults = DEFAULT_MAX_RESULTS, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!query.trim()) throw new Error('Query cannot be empty');
  maxResults = Math.max(1, Math.min(maxResults, MAX_RESULTS));
  timeoutMs = Math.min(timeoutMs, 60_000);

  const encoded = urlEncode(query.trim());
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!resp.ok) throw new Error(`Web search failed: HTTP ${resp.status}`);
    const body = await resp.text();
    const results = parseDuckDuckGoResults(body, maxResults);

    return { query: query.trim(), results };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Web search timed out after ${timeoutMs}ms for query: ${query.trim()}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── HTML parsing ────────────────────────────────────────────────────────────

export function parseDuckDuckGoResults(html, maxResults) {
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>(.*?)<\/div>/g;

  // Find every title-anchor position first, so each result's snippet can be
  // searched WITHIN that result's own region (from its title to the next
  // title). A previous version paired snippets to titles by a global ordinal
  // that also advanced for skipped empty-title anchors, shifting every later
  // snippet by one — so a title with no snippet stole the next result's.
  const titleMatches = [];
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    titleMatches.push({ href: m[1] ?? '', rawTitle: m[2] ?? '', start: m.index, end: titleRe.lastIndex });
  }

  const results = [];
  for (let i = 0; i < titleMatches.length; i++) {
    if (results.length >= maxResults) break;
    const tm = titleMatches[i];
    const title = normalizeText(tm.rawTitle);
    if (!title) continue; // skip image/sponsored anchors without shifting anyone
    const url = normalizeUrl(tm.href);
    // The snippet for this result lives between this title and the next one.
    const regionEnd = i + 1 < titleMatches.length ? titleMatches[i + 1].start : html.length;
    const region = html.slice(tm.end, regionEnd);
    snippetRe.lastIndex = 0;
    const sm = snippetRe.exec(region);
    const snippet = sm ? normalizeText(sm[1] ?? sm[2] ?? '') : '';
    results.push({ title, url, ...(snippet ? { snippet } : {}) });
  }

  return results;
}

function normalizeUrl(href) {
  const uddg = extractQueryParam(href, 'uddg');
  if (uddg) {
    const decoded = percentDecode(uddg);
    if (decoded) return decoded;
  }
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://duckduckgo.com${href}`;
  return href;
}

export function normalizeText(text) {
  return decodeHtmlEntities(stripHtmlTags(text)).replace(/\s+/g, ' ').trim();
}

function urlEncode(input) {
  let out = '';
  for (const byte of Buffer.from(input)) {
    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) ||
        (byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x5f ||
        byte === 0x2e || byte === 0x7e) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      out += '+';
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

export function percentDecode(input) {
  const bytes = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === '%' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      const val = parseInt(hex, 16);
      if (!isNaN(val)) { bytes.push(val); i += 3; continue; }
      // Malformed escape — fall through and preserve the literal '%' below.
    }
    if (input[i] === '+') {
      bytes.push(0x20);
      i += 1;
      continue;
    }
    // Literal characters: pull the full code point (handling surrogate pairs)
    // and emit its UTF-8 bytes. The prior implementation pushed charCodeAt(i)
    // directly, which silently corrupted any literal non-ASCII character (e.g.,
    // a literal "é" produced 0xE9 — invalid UTF-8 — instead of 0xC3 0xA9).
    const cp = input.codePointAt(i);
    const charBytes = Buffer.from(String.fromCodePoint(cp), 'utf-8');
    for (const b of charBytes) bytes.push(b);
    i += cp > 0xffff ? 2 : 1;  // surrogate pair advances 2 UTF-16 code units
  }
  return Buffer.from(bytes).toString('utf-8');
}

function extractQueryParam(url, key) {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return undefined;
  const query = url.slice(qIdx + 1);
  for (const part of query.split('&')) {
    const eqIdx = part.indexOf('=');
    const name = eqIdx === -1 ? part : part.slice(0, eqIdx);
    if (name === key) return eqIdx === -1 ? '' : part.slice(eqIdx + 1);
  }
  return undefined;
}
