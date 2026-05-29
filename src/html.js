// Minimal HTML text helpers shared by webfetch.js (page extraction) and
// websearch.js (DuckDuckGo result parsing). Previously both modules carried
// identical copies of decodeHtmlEntities + safeFromCodePoint.

function safeFromCodePoint(cp) {
  try { return String.fromCodePoint(cp); }
  catch { return ''; }
}

// Decode the small set of HTML entities that show up in scraped titles/snippets.
// Numeric (&#NN; / &#xNN;) entities are decoded first; &amp; is decoded LAST so
// an already-decoded "&" from an earlier rule isn't re-interpreted.
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

// Strip all HTML tags from a fragment.
export function stripHtmlTags(text) {
  return text.replace(/<[^>]+>/g, '');
}
