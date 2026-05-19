// Loads Chinese-author prose-voice definitions from .md files in the
// author-styles/ directory. Each .md file has YAML-like frontmatter
// (name, category) and ## Outline / ## Scene sections. Only ## Scene is
// consumed (prose voice for clip generation); ## Outline is ignored.
//
// This module is an intentional structural twin of src/styles.js but is
// kept fully separate so the 短剧 trope system and the author-voice system
// never share state, parsers, or registries.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTHOR_STYLES_DIR = join(__dirname, '..', 'author-styles');

function parseFrontmatter(content) {
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

function extractSection(body, heading) {
  const re = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(re);
  return match ? match[1].trim() : '';
}

function loadAuthorStylesFromDisk() {
  const styles = {};
  let categories;
  try {
    categories = readdirSync(AUTHOR_STYLES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return styles;
  }

  for (const category of categories) {
    const catDir = join(AUTHOR_STYLES_DIR, category);
    let files;
    try {
      files = readdirSync(catDir).filter(f => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      const key = basename(file, '.md');
      const raw = readFileSync(join(catDir, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const scene = extractSection(body, 'Scene');
      if (!scene) {
        console.warn(`[author-styles] "${key}" has no ## Scene section — it will inject no voice.`);
      }
      styles[key] = {
        name: meta.name || key,
        category: meta.category || category,
        scene,
      };
    }
  }

  return styles;
}

let _cache = null;
let _aliasCache = null;

function getAuthorStyles() {
  if (!_cache) _cache = loadAuthorStylesFromDisk();
  return _cache;
}

export function clearAuthorStyleCache() {
  _cache = null;
  _aliasCache = null;
}

// Whitespace- and case-insensitive normalization. "Mo Yan" and "moyan" both
// normalize to "moyan"; Chinese names ("莫言") pass through unchanged.
function normalizeAlias(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
}

// Build an index mapping every accepted spelling of an author to its
// canonical filename key: the Chinese name (莫言), the English name (Mo Yan),
// the full `name` field (Mo Yan (莫言)), and the original filename key
// (moyan). Author names are distinct, so cross-author collisions don't occur;
// filename keys are written last so they always win.
function getAliasIndex() {
  if (_aliasCache) return _aliasCache;
  const styles = getAuthorStyles();
  const idx = {};
  const add = (alias, key) => {
    const n = normalizeAlias(alias);
    if (n && !(n in idx)) idx[n] = key;
  };
  for (const [key, style] of Object.entries(styles)) {
    add(style.name, key);
    const m = String(style.name).match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m) {
      add(m[1], key); // English part
      add(m[2], key); // Chinese part
    }
  }
  for (const key of Object.keys(styles)) idx[normalizeAlias(key)] = key;
  _aliasCache = idx;
  return idx;
}

function resolveStyle(input) {
  const styles = getAuthorStyles();
  const key = getAliasIndex()[normalizeAlias(input)];
  return key ? styles[key] : null;
}

export function getAuthorStyle(input) {
  if (!input || input === 'default') return null;
  const style = resolveStyle(input);
  if (!style) {
    const styles = getAuthorStyles();
    const available = Object.entries(styles)
      .map(([k, v]) => `  ${v.name}  [key: ${k}]`)
      .join('\n');
    throw new Error(`Unknown author style: "${input}"\nAvailable author styles: (type the author name or the key)\n${available}`);
  }
  return style;
}

const _warnedMissing = new Set();
export function getAuthorStyleSafe(input) {
  if (!input || input === 'default') return null;
  const style = resolveStyle(input);
  if (!style) {
    const seen = normalizeAlias(input);
    if (!_warnedMissing.has(seen)) {
      _warnedMissing.add(seen);
      console.warn(`[author-styles] Unknown author style "${input}" — generating without an author voice. Run 'duanju-writer author-styles' to see available options.`);
    }
    return null;
  }
  return style;
}

export function listAuthorStyles() {
  const styles = getAuthorStyles();
  return Object.entries(styles).map(([key, style]) => ({
    key,
    name: style.name,
    category: style.category,
  }));
}
