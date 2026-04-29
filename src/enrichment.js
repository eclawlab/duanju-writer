import { callLLM } from './llm.js';

/**
 * Strips scene tags from text before word counting.
 * Tags: [narrator], [character:...], [player], [choice]
 * @param {string} text
 * @returns {string}
 */
function stripTags(text) {
  return text.replace(/\[narrator\]|\[character:[^\]]*\]|\[player\]|\[choice\]/g, '');
}

/**
 * Count words in text, excluding scene tags.
 * For CJK text (no spaces between words), counts characters as words.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text) return 0;
  const stripped = stripTags(text);
  // Count CJK characters individually (each ≈ 1 word)
  const cjkCount = (stripped.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  // Count Latin/other words by whitespace splitting (excluding CJK chars)
  const nonCjk = stripped.replace(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, '');
  const latinCount = nonCjk.split(/\s+/).filter(w => w.length > 0).length;
  return cjkCount + latinCount;
}

/**
 * Count Chinese characters only — used for clip-length budgeting where the
 * target is "spoken content per 10–15s clip". Whitespace, punctuation, and
 * ASCII don't contribute to spoken duration.
 * @param {string} text
 * @returns {number}
 */
export function countChars(text) {
  if (!text) return 0;
  const stripped = stripTags(text);
  return (stripped.match(/[一-鿿㐀-䶿]/g) || []).length;
}

/**
 * Returns true if the content word count is below 80% of targetWords.
 * Returns false if targetWords is 0 or falsy (feature disabled).
 * @param {string} content
 * @param {number} targetWords
 * @returns {boolean}
 */
export function needsEnrichment(content, targetWords) {
  if (!targetWords) return false;
  return countWords(content) < targetWords * 0.8;
}

/**
 * Builds a prompt asking the LLM to expand a scene to approximately targetWords words.
 * @param {string} content
 * @param {number} targetWords
 * @param {string} [lang='en']
 * @returns {string}
 */
export function buildEnrichmentPrompt(content, targetWords, lang = 'cn') {
  if (lang === 'cn') {
    return [
      '你正在扩写一个场景以达到字数目标。当前场景内容太短。',
      '',
      '## 当前场景内容',
      '',
      content,
      '',
      '## 要求',
      '',
      `- 将此场景扩写至大约 ${targetWords} 个词`,
      '- 保留所有场景标签：[narrator]、[character:...]、[player]、[choice]',
      '- 保留完全相同的情节事件、角色行为和对话含义',
      '- 添加：更丰富的描写、感官细节、内心想法、环境氛围',
      '- 不要添加新的情节事件或改变故事内容',
      '- 仅返回扩写后的场景内容，格式与原文相同',
    ].join('\n');
  }

  return [
    'You are expanding a scene to meet a word count target. The current scene is too short.',
    '',
    '## Current Scene Content',
    '',
    content,
    '',
    '## Requirements',
    '',
    `- Expand this scene to approximately ${targetWords} words`,
    '- Preserve ALL scene tags: [narrator], [character:...], [player], [choice]',
    '- Preserve the exact same plot events, character actions, and dialogue meaning',
    '- Add: richer descriptions, sensory details, internal thoughts, environmental atmosphere',
    '- Do NOT add new plot events or change the story',
    '- Return only the expanded scene content, same format as the original',
  ].join('\n');
}

/**
 * Calls the LLM to expand a scene to approximately targetWords words.
 * @param {string} content
 * @param {number} targetWords
 * @param {string} [lang='en']
 * @returns {Promise<string>}
 */
export async function enrichScene(content, targetWords, lang = 'cn') {
  const prompt = buildEnrichmentPrompt(content, targetWords, lang);
  return callLLM(prompt, 'clip');
}
