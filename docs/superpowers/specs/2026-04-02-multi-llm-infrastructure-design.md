# Sub-project A: Multi-LLM Infrastructure

## Goal

Replace the single Claude CLI backend with a flexible provider adapter system supporting OpenAI, DeepSeek, Qwen, and any OpenAI-compatible API. Enable per-step model assignment so different pipeline stages can use different LLMs.

## Providers

### OpenAI-Compatible Adapter

Handles OpenAI, DeepSeek, Qwen, and any OpenAI-compatible endpoint via `fetch` to `/v1/chat/completions`.

**Config fields:**
- `type`: `"openai"` (literal)
- `apiKey`: API key string
- `baseUrl`: API base URL (e.g., `https://api.deepseek.com/v1`)
- `model`: Model identifier (e.g., `deepseek-chat`, `qwen-max`, `gpt-4o`)
- `temperature`: 0.0-1.0 (default 0.7)
- `maxTokens`: Max response tokens (default 8192)
- `timeout`: Request timeout in ms (default 120000)

**Implementation:** Single `fetch` call to `${baseUrl}/chat/completions` with `Authorization: Bearer ${apiKey}`. Request body: `{ model, messages: [{ role: "user", content: prompt }], temperature, max_tokens }`. Parse `response.choices[0].message.content`.

### Claude CLI Adapter

Existing `execFile` logic extracted from current `src/claude.js`. Uses CLI authentication (no API key needed).

**Config fields:**
- `type`: `"claude-cli"` (literal)
- `claudePath`: Path to claude binary (default `"claude"`)
- `timeout`: Timeout in ms (default 300000)

**Implementation:** Preserved from current `claude.js` — `execFile(claudePath, ['-p', '--output-format', 'json', '--no-session-persistence'])`, writes prompt to stdin, parses JSON envelope output.

## Unified Interface

```js
// src/llm.js exports:

createProvider(config)
// Returns { call(prompt) → Promise<string> }
// Dispatches to OpenAI adapter or Claude CLI adapter based on config.type

callLLM(prompt, role)
// Looks up which provider is assigned to the role in config.roles
// Creates/caches the provider adapter
// Calls provider.call(prompt)
// Returns the response string
```

## Pipeline Roles

8 independently configurable roles, each mapped to a provider name:

| Role | Used By | Default Provider |
|------|---------|-----------------|
| `research` | `collector.js` — material collection | `claude` |
| `outline` | `writer.js` — outline generation | `claude` |
| `plan` | `planner.js` — planning agent | `claude` |
| `scene` | `writer.js` — scene generation | `claude` |
| `compress` | `compressor.js` — history compression | `claude` |
| `consistency` | `consistency.js` — prose rewrite | `claude` |
| `style` | `writer.js` — style auto-pick | `claude` |
| `repair` | `writer.js` — JSON repair | `claude` |

## Config Structure

Added to `~/.story-writer/config.json` alongside existing keys:

```json
{
  "providers": {
    "claude": { "type": "claude-cli", "claudePath": "claude", "timeout": 300000 },
    "deepseek": { "type": "openai", "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat", "temperature": 0.7, "maxTokens": 8192, "timeout": 120000 }
  },
  "roles": {
    "research": "claude",
    "outline": "claude",
    "plan": "claude",
    "scene": "claude",
    "compress": "claude",
    "consistency": "claude",
    "style": "claude",
    "repair": "claude"
  }
}
```

**Backward compatibility:** If `providers` is absent, auto-creates a `claude` provider from existing `claudePath` config. If `roles` is absent, all roles default to `claude`.

## CLI Commands

```bash
# Provider management
story-writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key> [--temperature 0.7] [--max-tokens 8192] [--timeout 120000]
story-writer provider list
story-writer provider remove <name>
story-writer provider test <name>

# Role assignment
story-writer role set <role> <provider>
story-writer role list
```

`provider test` sends a simple prompt ("Say hello in one word.") and verifies a response is returned.

## File Changes

### New Files

| File | Responsibility |
|------|----------------|
| `src/llm.js` | Provider adapter factory, cached provider instances, `callLLM(prompt, role)` |
| `tests/llm.test.js` | Tests for adapter creation, config parsing, role resolution, OpenAI request building |

### Modified Files

| File | Change |
|------|--------|
| `src/config.js` | Add `providers` and `roles` to DEFAULTS. Add `getProvider(name)` and `getRole(role)` helpers. |
| `src/claude.js` | Extract Claude CLI logic into an adapter function. Keep `callClaude` as a thin wrapper calling `callLLM(prompt, 'scene')` for backward compat. |
| `src/collector.js` | Change `callClaude(prompt)` → `callLLM(prompt, 'research')` |
| `src/writer.js` | Change `callClaude(prompt)` calls to use appropriate roles: `callLLM(prompt, 'outline')`, `callLLM(prompt, 'scene')`, `callLLM(prompt, 'style')`, `callLLM(prompt, 'repair')` |
| `src/planner.js` | Change `callClaude(prompt)` → `callLLM(prompt, 'plan')` |
| `src/compressor.js` | Change `callClaude(prompt)` → `callLLM(prompt, 'compress')` |
| `src/consistency.js` | Change `callClaude(prompt)` → `callLLM(prompt, 'consistency')` |
| `bin/story-writer.js` | Add `provider` and `role` commands |

## Error Handling

- Provider `call()` throws on HTTP errors, timeouts, empty responses
- `callLLM` throws `Error("Provider not found: <name>")` if role maps to unknown provider
- `callLLM` throws `Error("Unknown provider type: <type>")` if config.type is invalid
- OpenAI adapter throws `Error("LLM request failed: HTTP <status>")` on non-2xx
- OpenAI adapter throws `Error("LLM request timed out after <ms>ms")` on timeout
- All errors propagate up to the pipeline's existing try/catch handlers

## Testing Strategy

- Unit test adapter creation (OpenAI config → correct fetch URL construction)
- Unit test role resolution (config lookup, default fallback)
- Unit test Claude CLI adapter (preserved behavior from existing claude.test.js)
- Unit test `provider test` command logic
- Integration: existing 165 tests continue to pass (backward compat)
