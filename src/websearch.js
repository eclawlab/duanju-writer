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

function parseDuckDuckGoResults(html, maxResults) {
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>(.*?)<\/div>/g;

  const snippets = [];
  let m;
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(normalizeText(m[1] ?? m[2] ?? ''));
  }

  const results = [];
  let idx = 0;
  while ((m = titleRe.exec(html)) !== null) {
    if (results.length >= maxResults) break;
    const href = m[1] ?? '';
    const title = normalizeText(m[2] ?? '');
    if (!title) { idx++; continue; }
    const url = normalizeUrl(href);
    const snippet = snippets[idx] || undefined;
    results.push({ title, url, ...(snippet ? { snippet } : {}) });
    idx++;
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

export function stripHtmlTags(text) {
  return text.replace(/<[^>]+>/g, '');
}

function safeFromCodePoint(cp) {
  try { return String.fromCodePoint(cp); }
  catch { return ''; }
}

export function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
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

function percentDecode(input) {
  const bytes = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === '%' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      const val = parseInt(hex, 16);
      if (!isNaN(val)) { bytes.push(val); i += 3; continue; }
      bytes.push(input.charCodeAt(i));
    } else if (input[i] === '+') {
      bytes.push(0x20);
    } else {
      bytes.push(input.charCodeAt(i));
    }
    i++;
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
