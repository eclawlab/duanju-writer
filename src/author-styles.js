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

function getAuthorStyles() {
  if (!_cache) _cache = loadAuthorStylesFromDisk();
  return _cache;
}

export function clearAuthorStyleCache() {
  _cache = null;
}

export function getAuthorStyle(key) {
  if (!key || key === 'default') return null;
  const styles = getAuthorStyles();
  const style = styles[key.toLowerCase()];
  if (!style) {
    const available = Object.entries(styles)
      .map(([k, v]) => `  ${k} — ${v.name}`)
      .join('\n');
    throw new Error(`Unknown author style: "${key}"\nAvailable author styles:\n${available}`);
  }
  return style;
}

const _warnedMissing = new Set();
export function getAuthorStyleSafe(key) {
  if (!key || key === 'default') return null;
  const styles = getAuthorStyles();
  const lookup = key.toLowerCase();
  const style = styles[lookup];
  if (!style) {
    if (!_warnedMissing.has(lookup)) {
      _warnedMissing.add(lookup);
      console.warn(`[author-styles] Unknown author style "${key}" — generating without an author voice. Run 'duanju-writer author-styles' to see available options.`);
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
