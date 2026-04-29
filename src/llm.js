import { execFile } from 'node:child_process';
import { loadConfig } from './config.js';
import { registerChild as defaultRegisterChild, unregisterChild as defaultUnregisterChild } from './pidfile.js';

// Module-level cache for provider instances
const providerCache = new Map();

// ─── LLM usage stats accumulator ────────────────────────────────────────────
const stats = { calls: 0, inputTokens: 0, outputTokens: 0, totalMs: 0, costUsd: 0 };

export function getLLMStats() { return { ...stats }; }
export function resetLLMStats() {
  stats.calls = 0; stats.inputTokens = 0; stats.outputTokens = 0;
  stats.totalMs = 0; stats.costUsd = 0;
}

/**
 * Creates an OpenAI-compatible HTTP adapter.
 * @param {object} config
 * @param {string} config.apiKey
 * @param {string} config.baseUrl
 * @param {string} config.model
 * @param {number} [config.temperature=0.7]
 * @param {number} [config.maxTokens=8192]
 * @param {number} [config.timeout=120000]
 * @returns {{ call(prompt: string): Promise<string> }}
 */
export function createOpenAIAdapter(config) {
  const {
    apiKey,
    baseUrl,
    model,
    temperature = 0.7,
    maxTokens = 8192,
    timeout = 120000,
  } = config;

  return {
    async call(prompt) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error(`LLM request timed out after ${timeout}ms`);
        }
        throw err;
      }

      clearTimeout(timer);

      if (!response.ok) {
        // Drain the body so the underlying socket isn't held until GC
        const errBody = await response.text().catch(() => '');
        const snippet = errBody ? ` - ${errBody.slice(0, 200)}` : '';
        throw new Error(`LLM request failed: HTTP ${response.status}${snippet}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('LLM returned empty response');
      }

      // Accumulate token usage if available. Coerce via Number() because some
      // OpenAI-compatible providers return token counts as strings — without
      // the coercion, += would do string concat and pollute stats permanently.
      if (data.usage) {
        const inTok = Number(data.usage.prompt_tokens);
        const outTok = Number(data.usage.completion_tokens);
        if (Number.isFinite(inTok)) stats.inputTokens += inTok;
        if (Number.isFinite(outTok)) stats.outputTokens += outTok;
      }

      return content;
    },
  };
}

/**
 * Creates a Claude CLI adapter using execFile.
 * @param {object} config
 * @param {string} [config.claudePath='claude']
 * @param {number} [config.timeout=1500000]
 * @returns {{ call(prompt: string): Promise<string> }}
 */
export function createClaudeCliAdapter(config) {
  const {
    claudePath = 'claude',
    timeout = 1500000,
    registerChild = defaultRegisterChild,
    unregisterChild = defaultUnregisterChild,
  } = config;

  return {
    call(prompt) {
      return new Promise((resolve, reject) => {
        let trackedPid = null;
        const done = (fn, value) => {
          if (trackedPid !== null) {
            try { unregisterChild(trackedPid); } catch {}
            trackedPid = null;
          }
          fn(value);
        };

        const child = execFile(
          claudePath,
          ['-p', '--output-format', 'json', '--no-session-persistence'],
          {
            timeout,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'utf8',
          },
          (err, stdout, stderr) => {
            if (err) {
              if (err.killed) {
                done(reject, new Error(`Claude CLI timed out after ${timeout}ms`));
              } else {
                done(reject, new Error(`Claude CLI failed: ${err.message}\n${stderr}`));
              }
              return;
            }

            try {
              let parsed;
              try {
                parsed = JSON.parse(stdout);
              } catch {
                // Not JSON — return raw stdout
                done(resolve, stdout);
                return;
              }

              if (parsed.is_error) {
                throw new Error(`Claude CLI error: ${parsed.result}`);
              }

              // Accumulate cost / tokens if available. Coerce numerics in case
              // a future Claude CLI version returns these as strings.
              const cost = Number(parsed.cost_usd);
              const inTok = Number(parsed.num_input_tokens);
              const outTok = Number(parsed.num_output_tokens);
              if (Number.isFinite(cost)) stats.costUsd += cost;
              if (Number.isFinite(inTok)) stats.inputTokens += inTok;
              if (Number.isFinite(outTok)) stats.outputTokens += outTok;

              done(resolve, parsed.result ?? stdout);
            } catch (parseErr) {
              done(reject, parseErr);
            }
          }
        );

        if (child.pid) {
          trackedPid = child.pid;
          try { registerChild(trackedPid); } catch {}
        }

        // Swallow EPIPE / stream errors here — the spawned process can close
        // stdin before we finish writing (e.g. fast-exiting binary, test
        // stubs like /bin/sleep). The actual call outcome is determined by
        // the execFile callback above, which surfaces the real error.
        child.stdin.on('error', () => {});
        child.stdin.write(prompt);
        child.stdin.end();
      });
    },
  };
}

/**
 * Factory that creates an adapter from a provider config object.
 * @param {{ type: string, [key: string]: any }} providerConfig
 * @returns {{ call(prompt: string): Promise<string> }}
 */
export function createProvider(providerConfig) {
  const { type, ...rest } = providerConfig;

  if (type === 'openai') {
    return createOpenAIAdapter(rest);
  }

  if (type === 'claude-cli') {
    return createClaudeCliAdapter(rest);
  }

  throw new Error(`Unknown provider type: ${type}`);
}

// Module-level model override — when set, all roles use this provider
let _modelOverride = null;
export function setModelOverride(providerName) {
  _modelOverride = providerName;
  // Drop cached provider instances so the next callLLM picks up the latest
  // config (e.g., changed env vars / API keys) for the overridden provider.
  // Without this, stale provider instances persist for the lifetime of the
  // process even after the user runs `setup` to update credentials.
  providerCache.clear();
}
export function getModelOverride() { return _modelOverride; }

/**
 * Calls the LLM for a given prompt and role, using config-defined providers.
 * Provider instances are cached by provider name.
 * @param {string} prompt
 * @param {string} role
 * @returns {Promise<string>}
 */
export async function callLLM(prompt, role) {
  const config = loadConfig();

  // Determine which provider name to use for this role
  const providerName = _modelOverride || config.roles?.[role] || 'claude';

  // Check cache first
  if (!providerCache.has(providerName)) {
    let provider;

    if (!config.providers || Object.keys(config.providers).length === 0) {
      // No providers configured — fall back to claude-cli using claudePath
      provider = createClaudeCliAdapter({
        claudePath: config.claudePath || 'claude',
        timeout: 1500000,
      });
    } else {
      const providerConfig = config.providers[providerName];
      if (!providerConfig) {
        throw new Error(`Provider not found: ${providerName}`);
      }
      provider = createProvider(providerConfig);
    }

    providerCache.set(providerName, provider);
  }

  const provider = providerCache.get(providerName);
  const start = Date.now();
  const result = await provider.call(prompt);
  stats.totalMs += Date.now() - start;
  stats.calls += 1;
  return result;
}

/**
 * Clears all cached provider instances.
 * Useful for testing and after config changes.
 */
export function clearProviderCache() {
  providerCache.clear();
}
