import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG_FILE } from './constants.js';

const DEFAULTS = {
  autostoryUrl: 'https://usaduanju.com',
  aiApiKey: '',
  heartbeatInterval: 1800000,
  claudePath: 'claude',
  maxRetries: 3,
  maxConcurrentJobs: 1,
  publishOnUpload: true,
  targetCharsPerClip: 50,         // 0 = disabled
  episodesPerDrama: 20,
  clipsPerEpisode: 6,
  lang: 'cn',
  genre: '',
  referenceCharacter: '',
  referenceEvent: '',
  style: 'default',
  providers: {
    claude: { type: 'claude-cli', claudePath: 'claude', timeout: 1500000 },
    openai: { type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: '', timeout: 120000 },
  },
  roles: {
    research: 'claude',
    outline: 'claude',
    'tail-outline': 'claude',
    plan: 'claude',
    clip: 'claude',
    compress: 'claude',
    consistency: 'claude',
    style: 'claude',
    repair: 'claude',
  },
};

export function loadConfigFrom(filePath) {
  let userConfig = {};
  if (existsSync(filePath)) {
    try {
      userConfig = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`Warning: failed to parse ${filePath}, using defaults: ${err.message}`);
    }
  }
  const merged = { ...DEFAULTS, ...userConfig };
  // Deep merge providers and roles (user additions don't replace defaults)
  merged.providers = { ...DEFAULTS.providers, ...(userConfig.providers || {}) };
  merged.roles = { ...DEFAULTS.roles, ...(userConfig.roles || {}) };
  // Migrate legacy claudePath into providers.claude
  if (merged.claudePath && merged.claudePath !== 'claude') {
    if (!merged.providers) merged.providers = {};
    if (!merged.providers.claude) merged.providers.claude = {};
    merged.providers.claude.claudePath = merged.claudePath;
    merged.providers.claude.type = 'claude-cli';
  }
  // Apply environment variable overrides for provider settings
  applyEnvOverrides(merged);
  return merged;
}

/**
 * Apply environment variable overrides to provider configs.
 * Env vars follow the pattern: PROVIDER_<NAME>_<FIELD>
 *   OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL
 *   CLAUDE_PATH
 *   <NAME>_API_KEY, <NAME>_MODEL, <NAME>_BASE_URL
 */
function applyEnvOverrides(config) {
  if (!config.providers) return;

  // OpenAI env vars
  if (config.providers.openai) {
    const p = config.providers.openai;
    if (process.env.OPENAI_API_KEY) p.apiKey = process.env.OPENAI_API_KEY;
    if (process.env.OPENAI_MODEL) p.model = process.env.OPENAI_MODEL;
    if (process.env.OPENAI_BASE_URL) p.baseUrl = process.env.OPENAI_BASE_URL;
  }

  // Claude env vars
  if (config.providers.claude) {
    if (process.env.CLAUDE_PATH) config.providers.claude.claudePath = process.env.CLAUDE_PATH;
  }

  // Generic pattern: <PROVIDER>_API_KEY, <PROVIDER>_MODEL, <PROVIDER>_BASE_URL
  for (const name of Object.keys(config.providers)) {
    if (name === 'openai' || name === 'claude') continue; // already handled
    const prefix = name.toUpperCase().replace(/-/g, '_');
    const p = config.providers[name];
    if (process.env[`${prefix}_API_KEY`]) p.apiKey = process.env[`${prefix}_API_KEY`];
    if (process.env[`${prefix}_MODEL`]) p.model = process.env[`${prefix}_MODEL`];
    if (process.env[`${prefix}_BASE_URL`]) p.baseUrl = process.env[`${prefix}_BASE_URL`];
  }
}

export function saveConfigTo(filePath, config) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function loadConfig() {
  return loadConfigFrom(CONFIG_FILE);
}

export function saveConfig(config) {
  saveConfigTo(CONFIG_FILE, config);
}

export function getProvider(name) {
  const config = loadConfig();
  const providers = config.providers || DEFAULTS.providers;
  return providers[name] || null;
}

export function getRole(role) {
  const config = loadConfig();
  const roles = config.roles || DEFAULTS.roles;
  return roles[role] || 'claude';
}
