// Loads writing style definitions from .md files in the styles/ directory.
// Each .md file has YAML-like frontmatter (name, category) and ## Outline / ## Scene sections.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = join(__dirname, '..', 'styles');

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

function extractSection(body, heading) {
  const re = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(re);
  return match ? match[1].trim() : '';
}

function loadStylesFromDisk() {
  const styles = {};
  let categories;
  try {
    categories = readdirSync(STYLES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return styles;
  }

  for (const category of categories) {
    const catDir = join(STYLES_DIR, category);
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
      const outline = extractSection(body, 'Outline');
      const scene = extractSection(body, 'Scene');
      if (!outline && !scene) continue;
      styles[key] = {
        name: meta.name || key,
        category: meta.category || category,
        outline,
        scene,
      };
    }
  }

  return styles;
}

let _cache = null;

function getStyles() {
  if (!_cache) _cache = loadStylesFromDisk();
  return _cache;
}

export function clearStyleCache() {
  _cache = null;
}

export function getStyle(key) {
  if (!key || key === 'default') return null;
  const styles = getStyles();
  const style = styles[key.toLowerCase()];
  if (!style) {
    const available = Object.entries(styles)
      .map(([k, v]) => `  ${k} — ${v.name}`)
      .join('\n');
    throw new Error(`Unknown style: "${key}"\nAvailable styles:\n${available}`);
  }
  return style;
}

const _warnedMissing = new Set();
export function getStyleSafe(key) {
  if (!key || key === 'default') return null;
  const styles = getStyles();
  const style = styles[key.toLowerCase()];
  if (!style) {
    if (!_warnedMissing.has(key)) {
      _warnedMissing.add(key);
      console.warn(`[styles] Unknown style "${key}" — falling back to default. Run 'story-writer styles' to see available styles.`);
    }
    return null;
  }
  return style;
}

export function listStyles() {
  const styles = getStyles();
  return Object.entries(styles).map(([key, style]) => ({
    key,
    name: style.name,
    category: style.category,
  }));
}

export function listCategories() {
  const styles = getStyles();
  const cats = new Map();
  for (const style of Object.values(styles)) {
    if (!cats.has(style.category)) cats.set(style.category, []);
    cats.get(style.category).push(style.name);
  }
  return [...cats.entries()].map(([category, names]) => ({ category, count: names.length }));
}
