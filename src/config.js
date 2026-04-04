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
  targetWordsPerScene: 0,  // 0 = disabled, set to e.g. 200 to enable
  lang: 'en',
  style: 'default',
  providers: {
    claude: { type: 'claude-cli', claudePath: 'claude', timeout: 300000 },
  },
  roles: {
    research: 'claude',
    outline: 'claude',
    plan: 'claude',
    scene: 'claude',
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
  return merged;
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
