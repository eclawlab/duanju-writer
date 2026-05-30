import { callLLM } from './llm.js';
import { tryParseJson } from './json.js';
import { buildSelftellDirective } from './selftell.js';

// JSON extraction helpers are shared via ./json.js.

// ─── Prompt builder ────────────────────────────────────────────────────────────

// Render a clip's spoken/action content for LLM compression. Reads structured
// beat fields directly from the scene; falls back to the older `_beats`
// ride-along (legacy artifacts from pre-flatten runs) and finally to the flat
// `content` string so this helper degrades gracefully across pipeline versions.
function clipBody(c) {
  const beats = c._beats || c;
  const parts = [];
  if (beats.setting)  parts.push(`场景：${beats.setting}`);
  if (beats.action)   parts.push(`动作：${beats.action}`);
  if (beats.dialogue) parts.push(beats.dialogue);
  if (beats.hook)     parts.push(`钩点：${beats.hook}`);
  if (parts.length > 0) return parts.join('\n');
  return c.content || '';
}

export function buildCompressPrompt(clips, lang = 'cn', mode = 'default') {
  const clipBlocks = clips.map((s, i) =>
    `### Clip ${i + 1}\n${clipBody(s)}`
  ).join('\n\n');

  // The compressed summary feeds priorClipDigest of subsequent clips, so in
  // selftell mode it must also stay in first person — otherwise downstream
  // clips receive a third-person summary as context, which leaks back into
  // their narration.
  let base;
  if (lang === 'cn') {
    base = [
      '你是一位专业的故事分析师。请阅读以下场景内容，并将其压缩成结构化的 JSON 摘要，以便注入到后续场景的上下文中。',
      '',
      '## 场景内容',
      '',
      clipBlocks,
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
  } else {
    base = [
      'You are a professional story analyst. Read the following scene content and compress it into a structured JSON summary for injection into future scene context.',
      '',
      '## Scene Content',
      '',
      clipBlocks,
      '',
      '## Output Requirements',
      '',
      'Return ONLY a valid JSON object with no explanation and no markdown code fences. The JSON object must contain these fields:',
      '',
      '- `summary` (string): a concise overall summary of all clips',
      '- `characterActions` (array): list of key actions taken by each character',
      '- `plotProgress` (array): list of major plot threads that have been advanced',
      '- `emotionalArc` (string): the overall emotional tone of these clips',
      '- `stateChanges` (object): with two array fields:',
      '  - `characters`: list of character state changes',
      '  - `items`: list of item/object state changes',
      '',
      'Example format:',
      '{"summary":"...","characterActions":["..."],"plotProgress":["..."],"emotionalArc":"...","stateChanges":{"characters":["..."],"items":["..."]}}',
    ].join('\n');
  }
  if (mode === 'selftell') {
    const extra = lang === 'cn'
      ? '\n\n注意：本剧使用主角自述（selftell）模式。`summary` 与 `emotionalArc` 必须保持主角第一人称（"我"、"我的"）视角；`characterActions` 中关于主角的条目也写作"我……"。其他角色仍按其姓名描述。'
      : '\n\nNote: this drama uses selftell mode (first-person retelling by the protagonist). The `summary` and `emotionalArc` MUST stay in the protagonist\'s first person ("I", "my"); entries in `characterActions` referring to the protagonist also use "I…". Other characters are still named normally.';
    base += extra + '\n' + buildSelftellDirective(lang, 'general');
  }
  return base;
}

// ─── Output parser ─────────────────────────────────────────────────────────────

export function parseCompressorOutput(raw) {
  const parsed = tryParseJson(raw);
  if (parsed) return parsed;
  throw new Error('Failed to parse compressor output as JSON');
}

// ─── Compress via Claude ───────────────────────────────────────────────────────

export async function compressClips(clips, lang = 'cn', mode = 'default', llmFn = callLLM) {
  const prompt = buildCompressPrompt(clips, lang, mode);
  const raw = await llmFn(prompt, 'compress');
  return parseCompressorOutput(raw);
}

// ─── Context formatter ─────────────────────────────────────────────────────────

export function buildHistoryContext(compressedScenes) {
  if (!compressedScenes || compressedScenes.length === 0) return '';

  return compressedScenes.map((scene, i) => {
    const label = `Clip ${i + 1}`;
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
