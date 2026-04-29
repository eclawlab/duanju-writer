const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAX_CONTENT_LENGTH = 50_000;
// Cap on raw body bytes BEFORE extraction. Without this, a misbehaving or
// malicious origin could return an unbounded body and exhaust memory before
// the post-extraction MAX_CONTENT_LENGTH truncation runs. Set generously
// (1 MB) so well-formed pages aren't truncated mid-document.
const MAX_BODY_BYTES = 1_000_000;

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

    // Reject obviously oversized responses based on Content-Length before
    // reading the body. (Origins can lie about Content-Length, so we also
    // cap the streamed read below.)
    const declaredLen = Number(resp.headers.get('content-length'));
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      throw new Error(`Response body too large (Content-Length=${declaredLen} > ${MAX_BODY_BYTES})`);
    }

    const body = await readBodyCapped(resp, MAX_BODY_BYTES);
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

async function readBodyCapped(resp, maxBytes) {
  if (!resp.body) return await resp.text();
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Decode what we have, including the chunk that crossed the limit
        // (truncated to the cap), then bail.
        const overflow = total - maxBytes;
        result += decoder.decode(value.subarray(0, value.byteLength - overflow), { stream: false });
        break;
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return result;
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
