// Lang-aware prompt template loading. Base templates in prompts/ are the
// Chinese (lang 'cn') versions; localized variants live in prompts/<lang>/
// under the same filename and are picked when present. Missing localized
// files fall back to the base template so a partially-translated language
// still runs end to end.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

export function resolvePromptPath(name, lang = 'cn') {
  if (lang && lang !== 'cn') {
    const localized = join(PROMPTS_DIR, lang, name);
    if (existsSync(localized)) return localized;
  }
  return join(PROMPTS_DIR, name);
}

export function loadPromptTemplate(name, lang = 'cn') {
  return readFileSync(resolvePromptPath(name, lang), 'utf8');
}
