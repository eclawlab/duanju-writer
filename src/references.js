// Shared assembly for reference-character / reference-event prompt blocks.
//
// Every pipeline stage (snowflake, outline, tail-outline, plan) injects the
// user-provided reference character/event with the same shape:
//
//   \n\n## <bilingual heading>\n\n<stage-specific instruction>\n\n---\n<content>\n---\n
//
// The *instruction* wording is intentionally stage-specific (outline talks
// about `episodes`, plan about `clips.events`, snowflake about the characters
// array / three-act structure, tail-outline about carrying the front half
// through). This module standardizes only the bilingual heading label and the
// fenced wrapper that all four stages previously hand-rolled.

const HEADINGS = {
  character: {
    required: { cn: '参考角色（必须使用）', en: 'Reference Character (REQUIRED)' },
    preserve: { cn: '参考角色（必须保留）', en: 'Reference Character (PRESERVE)' },
  },
  event: {
    required: { cn: '参考事件（必须使用）', en: 'Reference Event (REQUIRED)' },
    continue: { cn: '参考事件（必须延续）', en: 'Reference Event (CONTINUE)' },
  },
};

/**
 * @param {object} opts
 * @param {'character'|'event'} opts.kind
 * @param {string} [opts.lang='cn']
 * @param {'required'|'preserve'|'continue'} [opts.variant='required']
 * @param {string} opts.instruction - stage-specific directive text
 * @param {string} opts.content - the raw reference character/event text
 * @returns {string} the prompt block (leading \n\n included)
 */
export function buildReferenceBlock({ kind, lang = 'cn', variant = 'required', instruction = '', content = '' }) {
  const set = HEADINGS[kind]?.[variant];
  if (!set) throw new Error(`buildReferenceBlock: unknown kind/variant "${kind}"/"${variant}"`);
  const heading = set[lang === 'cn' ? 'cn' : 'en'];
  return `\n\n## ${heading}\n\n${instruction}\n\n---\n${content}\n---\n`;
}

// Genre/novel-type constraint block under the shared `## 题材要求` /
// `## Novel Type Requirement` heading. The body sentence is stage-specific
// (outline/plan/tail each phrase it differently), so the caller supplies the
// CN and EN bodies; this helper standardizes only the heading + wrapper.
// (snowflake.js deliberately uses a different inline `重要：` format and does
// not use this helper.)
export function buildGenreBlock(lang, cnBody, enBody) {
  const heading = lang === 'cn' ? '题材要求' : 'Novel Type Requirement';
  const body = lang === 'cn' ? cnBody : enBody;
  return `\n\n## ${heading}\n\n${body}\n`;
}
