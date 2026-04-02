import { callLLM } from './llm.js';

// ─── JSON extraction helpers (same pattern as writer.js / collector.js) ────────

function cleanRaw(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

// ─── Prompt builder ────────────────────────────────────────────────────────────

export function buildCompressPrompt(scenes, lang = 'en') {
  const sceneBlocks = scenes.map((s, i) =>
    `### Scene ${i + 1}\n${s.content}`
  ).join('\n\n');

  if (lang === 'cn') {
    return [
      '你是一位专业的故事分析师。请阅读以下场景内容，并将其压缩成结构化的 JSON 摘要，以便注入到后续场景的上下文中。',
      '',
      '## 场景内容',
      '',
      sceneBlocks,
      '',
      '## 输出要求',
      '',
      '请仅返回一个合法的 JSON 对象，不要包含任何解释或 markdown 代码围栏。JSON 对象必须包含以下字段：',
      '',
      '- `summary`（字符串）：对所有场景的简洁总体概括',
      '- `characterActions`（数组）：每个角色的主要行动列表',
      '- `plotProgress`（数组）：已推进的主要情节线索列表',
      '- `emotionalArc`（字符串）：这些场景的整体情感基调',
      '- `stateChanges`（对象）：包含两个数组字段：',
      '  - `characters`：角色状态变化列表',
      '  - `items`：道具/物品状态变化列表',
      '',
      '示例格式：',
      '{"summary":"...","characterActions":["..."],"plotProgress":["..."],"emotionalArc":"...","stateChanges":{"characters":["..."],"items":["..."]}}',
    ].join('\n');
  }

  return [
    'You are a professional story analyst. Read the following scene content and compress it into a structured JSON summary for injection into future scene context.',
    '',
    '## Scene Content',
    '',
    sceneBlocks,
    '',
    '## Output Requirements',
    '',
    'Return ONLY a valid JSON object with no explanation and no markdown code fences. The JSON object must contain these fields:',
    '',
    '- `summary` (string): a concise overall summary of all scenes',
    '- `characterActions` (array): list of key actions taken by each character',
    '- `plotProgress` (array): list of major plot threads that have been advanced',
    '- `emotionalArc` (string): the overall emotional tone of these scenes',
    '- `stateChanges` (object): with two array fields:',
    '  - `characters`: list of character state changes',
    '  - `items`: list of item/object state changes',
    '',
    'Example format:',
    '{"summary":"...","characterActions":["..."],"plotProgress":["..."],"emotionalArc":"...","stateChanges":{"characters":["..."],"items":["..."]}}',
  ].join('\n');
}

// ─── Output parser ─────────────────────────────────────────────────────────────

export function parseCompressorOutput(raw) {
  const cleaned = cleanRaw(raw);

  // Attempt 1: direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Attempt 2: extract JSON object from surrounding text
  const extracted = extractJsonObject(cleaned);
  if (extracted) return extracted;

  throw new Error('Failed to parse compressor output as JSON');
}

// ─── Compress via Claude ───────────────────────────────────────────────────────

export async function compressScenes(scenes, lang = 'en') {
  const prompt = buildCompressPrompt(scenes, lang);
  const raw = await callLLM(prompt, 'compress');
  return parseCompressorOutput(raw);
}

// ─── Context formatter ─────────────────────────────────────────────────────────

export function buildHistoryContext(compressedScenes) {
  if (!compressedScenes || compressedScenes.length === 0) return '';

  return compressedScenes.map((scene, i) => {
    const label = `Scene ${i + 1}`;
    const actions = (scene.characterActions || []).join('; ');
    const plot = (scene.plotProgress || []).join('; ');
    const tone = scene.emotionalArc || '';
    return [
      `${label}: ${scene.summary}`,
      `  Actions: ${actions}`,
      `  Plot: ${plot}`,
      `  Tone: ${tone}`,
    ].join('\n');
  }).join('\n');
}
