// Pure scene-composition helper. Lives in its own module so both drama-writer.js
// (clip generation) and selftell.js (first-person POV rewriting) can use it
// without a circular import.

/**
 * Compose four-beat clip data into a single block-format `content` string.
 * Each non-empty beat becomes a [narrator] block (dialogue is inserted verbatim
 * because the LLM emits it pre-formatted with [narrator]/[character:Name] tags).
 * Blocks are separated by a blank line. Throws if all beats are empty.
 */
export function composeScene({ setting, action, dialogue, hook }) {
  const blocks = [];
  if (setting && setting.trim()) blocks.push(`[narrator]\n${setting}`);
  if (action  && action.trim())  blocks.push(`[narrator]\n${action}`);
  if (dialogue && dialogue.trim()) blocks.push(dialogue);
  if (hook    && hook.trim())    blocks.push(`[narrator]\n${hook}`);
  if (blocks.length === 0) throw new Error('composeScene: empty content (all beats were empty)');
  return blocks.join('\n\n');
}
