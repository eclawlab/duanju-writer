const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAX_CONTENT_LENGTH = 50_000;

export async function fetchPage(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!url.trim()) throw new Error('URL cannot be empty');
  timeoutMs = Math.min(timeoutMs, 60_000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5,zh-CN;q=0.3,zh;q=0.2',
      },
    });

    if (!resp.ok) throw new Error(`Fetch failed: HTTP ${resp.status}`);
    const body = await resp.text();
    const content = extractContent(body);
    const title = extractTitle(body);

    return { url, title, content };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${timeoutMs}ms for URL: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function stripBlocks(html, tag) {
  const lower = html.toLowerCase();
  let result = '';
  let i = 0;
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  while (i < lower.length) {
    const openIdx = lower.indexOf(openTag, i);
    if (openIdx === -1) {
      result += html.slice(i);
      break;
    }
    result += html.slice(i, openIdx);
    const closeIdx = lower.indexOf(closeTag, openIdx);
    if (closeIdx === -1) {
      break;
    }
    i = closeIdx + closeTag.length;
  }
  return result;
}

export function extractContent(html) {
  // Remove script, style, and noscript blocks
  let cleaned = stripBlocks(html, 'script');
  cleaned = stripBlocks(cleaned, 'style');
  cleaned = stripBlocks(cleaned, 'noscript');

  // Replace block elements with newlines
  cleaned = cleaned.replace(
    /<\/?(p|div|li|ul|ol|br|h[1-6]|tr|td|th|table|section|article|header|footer|nav|main)[^>]*>/gi,
    '\n',
  );

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Decode entities
  cleaned = decodeHtmlEntities(cleaned);

  // Normalize whitespace per line, remove blank lines
  const lines = cleaned
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0);

  const result = lines.join('\n');
  if (result.length > MAX_CONTENT_LENGTH) {
    return result.slice(0, MAX_CONTENT_LENGTH);
  }
  return result;
}

export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return undefined;
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() || undefined;
}

function safeFromCodePoint(cp) {
  try { return String.fromCodePoint(cp); }
  catch { return ''; }
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
