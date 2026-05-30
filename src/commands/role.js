import { loadConfig, saveConfig } from '../config.js';

const VALID_ROLES = ['research', 'outline', 'tail-outline', 'plan', 'clip', 'compress', 'consistency', 'style', 'repair'];

// `duanju-writer role [set|list]`
export async function handleRole(args) {
  const sub = args[0];

  if (sub === 'set' && args[1] && args[2]) {
    const role = args[1];
    const provider = args[2];
    if (!VALID_ROLES.includes(role)) {
      console.log(`Unknown role: ${role}`);
      console.log(`Valid roles: ${VALID_ROLES.join(', ')}`);
      process.exit(1);
    }
    const config = loadConfig();
    const providers = config.providers || {};
    if (!providers[provider]) {
      console.log(`Provider "${provider}" not found. Add it first with: duanju-writer provider add ${provider} ...`);
      process.exit(1);
    }
    if (!config.roles) config.roles = {};
    config.roles[role] = provider;
    saveConfig(config);
    console.log(`Role "${role}" → provider "${provider}"`);

  } else if (sub === 'list') {
    const config = loadConfig();
    const roles = config.roles || {};
    console.log('Role assignments:\n');
    for (const role of VALID_ROLES) {
      console.log(`  ${role.padEnd(14)} → ${roles[role] || 'claude'}`);
    }

  } else {
    console.log('Usage: duanju-writer role [set|list]');
    console.log('\nExamples:');
    console.log('  duanju-writer role list');
    console.log('  duanju-writer role set scene deepseek');
  }
}
