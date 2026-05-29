import chalk from 'chalk';
import { callLLM } from './llm.js';

// Shared JSON extraction + LLM-repair helpers used across every pipeline stage
// that consumes raw LLM output (outline / clip / plan / materials / bible /
// compress / modify). Previously each module carried its own near-identical
// copy; centralizing here keeps a single tested implementation.

// Strip surrounding markdown code fences and whitespace from a raw LLM response.
export function cleanRaw(raw) {
  let cleaned = String(raw).trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

// Slice from the first { to the last } and attempt a parse. Handles responses
// where the model wrapped the JSON in prose/greetings despite instructions.
export function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

// Parse already-cleaned text directly, then fall back to object-extraction.
// Returns null on total failure. Use when the caller has already stripped
// fences (or wants to control cleaning separately).
export function parseJsonLoose(cleaned) {
  try { return JSON.parse(cleaned); } catch {}
  const extracted = extractJsonObject(cleaned);
  if (extracted) return extracted;
  return null;
}

// Best-effort parse: clean fences, direct parse, then object-extraction.
// Returns null on total failure (caller decides whether to repair/throw).
export function tryParseJson(raw) {
  return parseJsonLoose(cleanRaw(raw));
}

// Ask the LLM to repair malformed JSON, then re-parse. Costs an extra
// round-trip, so we surface the invocation (low-visual-weight) to make
// recurring malformation visible. llmFn is injectable for tests.
export async function repairJson(broken, label, llmFn = callLLM) {
  console.log(chalk.dim(`  [json-repair] ${label}: primary parse failed, invoking LLM repair pass`));

  const prompt = [
    'The following text was supposed to be valid JSON but has syntax errors.',
    'Common issues: unescaped quotes inside strings, missing commas, trailing commas, unescaped newlines in strings.',
    'Fix ALL issues and return ONLY the corrected valid JSON object. No explanation, no markdown fences.',
    '',
    broken,
  ].join('\n');

  const fixed = await llmFn(prompt, 'repair');
  const result = tryParseJson(fixed);
  if (result) return result;

  // Last resort: try extracting from the raw repair output.
  const extracted = extractJsonObject(fixed);
  if (extracted) return extracted;

  throw new Error(`Failed to parse ${label} JSON even after LLM repair`);
}

// Primary parse with LLM-repair fallback. Throws if even repair fails.
export async function parseJsonWithRepair(raw, label, llmFn = callLLM) {
  const result = tryParseJson(raw);
  if (result) return result;
  return await repairJson(cleanRaw(raw), label, llmFn);
}
