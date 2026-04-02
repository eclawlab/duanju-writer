import { callLLM } from './llm.js';

export function buildArgs(claudePath) {
  return {
    cmd: claudePath,
    flags: ['-p', '--output-format', 'json', '--no-session-persistence'],
  };
}

export function parseClaudeOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed.is_error) {
      throw new Error(`Claude CLI error: ${parsed.result}`);
    }
    return parsed.result ?? stdout;
  } catch (err) {
    if (err.message.startsWith('Claude CLI error')) throw err;
    return stdout;
  }
}

export function callClaude(prompt, options = {}) {
  return callLLM(prompt, options.role || 'scene');
}
