import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG_FILE } from './constants.js';

const DEFAULTS = {
  autostoryUrl: 'https://autostory-web.fly.dev',
  aiApiKey: '',
  heartbeatInterval: 1800000,
  claudePath: 'claude',
  maxRetries: 3,
  maxConcurrentJobs: 1,
  publishOnUpload: true,
  lang: 'en',
  style: 'default',
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
  return { ...DEFAULTS, ...userConfig };
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
