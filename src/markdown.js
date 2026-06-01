// Pure, stateless Markdown helpers for the .md-backed definition files
// (styles/, author-styles/). Shared by styles.js and author-styles.js — these
// functions hold no state, so sharing them does not couple the two registries.

// Parse YAML-ish frontmatter (`---\nkey: value\n---`) into { meta, body }.
// Lines without a colon are skipped. Returns the whole content as `body` when
// no frontmatter block is present.
export function parseFrontmatter(content) {
  // Normalize CRLF → LF so files edited on Windows still parse (the regex and
  // the line split below assume LF; a stray \r would orphan the closing ---).
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

// Extract the body of a `## <heading>` section up to the next `## ` or EOF.
// No `m` flag so `$` means end-of-string (a multiline `$` would stop at the
// section's first blank line). Returns '' when the heading isn't found.
export function extractSection(body, heading) {
  body = body.replace(/\r\n/g, '\n');
  const re = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(re);
  return match ? match[1].trim() : '';
}
