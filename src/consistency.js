import { callLLM } from './llm.js';

// Strip narrator/character/player/choice tags from content before processing
function stripTags(content) {
  return content
    .replace(/\[narrator\]/gi, '')
    .replace(/\[character:[^\]]*\]/gi, '')
    .replace(/\[player\]/gi, '')
    .replace(/\[choice\]/gi, '')
    .trim();
}

// Split text into sentences.
// ASCII .!? require following whitespace or end-of-string (avoids splitting "Dr." or "3.5").
// CJK 。！？ always split (they're unambiguous sentence terminators, never followed by space in Chinese).
function splitSentences(text) {
  return text
    .split(/[.!?](?:\s+|$)|[。！？]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Extract the first word of a sentence
function firstWord(sentence) {
  const match = sentence.match(/^([A-Za-z\u4e00-\u9fff]+)/);
  return match ? match[1] : null;
}

// Extract n-word phrases from a sentence
function extractPhrases(sentence, minLen, maxLen) {
  const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const phrases = [];
  for (let n = minLen; n <= maxLen; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      phrases.push(words.slice(i, i + n).join(' '));
    }
  }
  return phrases;
}

/**
 * Finds words that start 3+ sentences.
 * Returns issue strings for each such word, or [] if none.
 */
export function findRepetitiveOpeners(content) {
  const cleaned = stripTags(content);
  const sentences = splitSentences(cleaned);
  const counts = {};
  for (const sentence of sentences) {
    const word = firstWord(sentence);
    if (word) {
      counts[word] = (counts[word] || 0) + 1;
    }
  }
  const issues = [];
  for (const [word, count] of Object.entries(counts)) {
    if (count >= 3) {
      issues.push(`Repetitive opener: "${word}" starts ${count} sentences`);
    }
  }
  return issues;
}

/**
 * Finds 3-5 word phrases that appear 3+ times.
 * Returns issue strings, or [] if none.
 */
export function findOverusedPhrases(content) {
  const cleaned = stripTags(content);
  const sentences = splitSentences(cleaned);
  const counts = {};
  for (const sentence of sentences) {
    const phrases = extractPhrases(sentence, 3, 5);
    for (const phrase of phrases) {
      counts[phrase] = (counts[phrase] || 0) + 1;
    }
  }
  const issues = [];
  for (const [phrase, count] of Object.entries(counts)) {
    if (count >= 3) {
      issues.push(`Overused phrase: "${phrase}" appears ${count} times`);
    }
  }
  return issues;
}

/**
 * Checks if any tracked motif phrase appears in content within the cooldown window.
 * Cooldown: (sceneIndex - lastScene) < 3. If elapsed (4+ scenes later), no issue.
 */
export function checkMotifCooldown(content, tracker, sceneIndex) {
  const lowerContent = content.toLowerCase();
  const issues = [];
  for (const [phrase, lastScene] of Object.entries(tracker)) {
    if (lowerContent.includes(phrase) && (sceneIndex - lastScene) < 3) {
      issues.push(`Motif cooldown: "${phrase}" was used ${sceneIndex - lastScene} scene(s) ago (cooldown: 3 scenes)`);
    }
  }
  return issues;
}

/**
 * Extracts 4-5 word phrases from content and records them in tracker at sceneIndex.
 * Prunes entries older than the cooldown window (3 scenes) to prevent unbounded growth.
 */
export function updateMotifTracker(tracker, content, sceneIndex) {
  // Prune entries outside the cooldown window
  for (const phrase of Object.keys(tracker)) {
    if (sceneIndex - tracker[phrase] >= 3) {
      delete tracker[phrase];
    }
  }

  const cleaned = stripTags(content);
  const sentences = splitSentences(cleaned);
  for (const sentence of sentences) {
    const phrases = extractPhrases(sentence, 4, 5);
    for (const phrase of phrases) {
      tracker[phrase] = sceneIndex;
    }
  }
}

/**
 * Combines all three checks. Returns { issues: [...] }.
 */
export function checkConsistency(content, motifTracker, sceneIndex) {
  const issues = [
    ...findRepetitiveOpeners(content),
    ...findOverusedPhrases(content),
    ...checkMotifCooldown(content, motifTracker, sceneIndex),
  ];
  return { issues };
}

/**
 * Builds a prompt asking Claude to rewrite content to fix the listed issues.
 * Uses Chinese instructions for lang === 'cn'.
 */
export function buildRewritePrompt(content, issues, lang = 'en') {
  const issueList = issues.map(i => `- ${i}`).join('\n');
  if (lang === 'cn') {
    return `你是一位专业的互动小说作家。请修改以下段落以解决文风问题，同时保留原有的故事内容和情节。

发现的问题：
${issueList}

原始内容：
${content}

请在保留情节和人物的前提下，改写内容以解决上述问题。只返回改写后的正文，不要添加任何解释。`;
  }
  return `You are a professional interactive fiction writer. Please rewrite the following passage to fix the listed style issues while preserving the story content and plot.

Issues to fix:
${issueList}

Original content:
${content}

Rewrite the content to address the issues above while keeping the plot and characters intact. Return only the rewritten prose, with no additional explanation.`;
}

/**
 * Calls Claude to rewrite content for consistency. Not tested directly.
 */
export async function rewriteForConsistency(content, issues, lang = 'en') {
  const prompt = buildRewritePrompt(content, issues, lang);
  return callLLM(prompt, 'consistency');
}
