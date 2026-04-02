import { execFile } from 'node:child_process';
import { CLAUDE_TIMEOUT } from './constants.js';
import { loadConfig } from './config.js';

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
  const config = loadConfig();
  const claudePath = options.claudePath || config.claudePath || 'claude';
  const timeout = options.timeout || CLAUDE_TIMEOUT;
  const { cmd, flags } = buildArgs(claudePath);

  return new Promise((resolve, reject) => {
    const child = execFile(cmd, flags, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(new Error(`Claude CLI timed out after ${timeout}ms`));
        } else {
          reject(new Error(`Claude CLI failed: ${err.message}\n${stderr}`));
        }
        return;
      }
      try {
        const result = parseClaudeOutput(stdout);
        resolve(result);
      } catch (parseErr) {
        reject(parseErr);
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
