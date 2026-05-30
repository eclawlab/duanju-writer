import { loadConfig, saveConfig } from '../config.js';

// `duanju-writer provider [add|list|remove|test] [name] [--flags]`
// args is the post-subcommand argv (args[0] is the sub-action).
export async function handleProvider(args) {
  const sub = args[0];

  if (sub === 'add' && args[1]) {
    const name = args[1];
    const flags = {};
    for (let a = 2; a < args.length; a++) {
      if (args[a] === '--type' && args[a + 1]) { flags.type = args[a + 1]; a++; }
      else if (args[a] === '--base-url' && args[a + 1]) { flags.baseUrl = args[a + 1]; a++; }
      else if (args[a] === '--model' && args[a + 1]) { flags.model = args[a + 1]; a++; }
      else if (args[a] === '--api-key' && args[a + 1]) { flags.apiKey = args[a + 1]; a++; }
      else if (args[a] === '--temperature' && args[a + 1]) { flags.temperature = Number(args[a + 1]); a++; }
      else if (args[a] === '--max-tokens' && args[a + 1]) { flags.maxTokens = Number(args[a + 1]); a++; }
      else if (args[a] === '--timeout' && args[a + 1]) { flags.timeout = Number(args[a + 1]); a++; }
    }
    if (!flags.type) {
      console.log('--type is required (openai or claude-cli)');
      process.exit(1);
    }
    if (flags.type === 'openai' && (!flags.baseUrl || !flags.model || !flags.apiKey)) {
      console.log('OpenAI providers require: --base-url, --model, --api-key');
      process.exit(1);
    }
    const config = loadConfig();
    if (!config.providers) config.providers = {};
    config.providers[name] = flags;
    saveConfig(config);
    console.log(`Provider "${name}" added (type: ${flags.type}, model: ${flags.model || 'N/A'})`);

  } else if (sub === 'list') {
    const config = loadConfig();
    const providers = config.providers || {};
    if (Object.keys(providers).length === 0) {
      console.log('No providers configured.');
    } else {
      console.log('Configured providers:\n');
      for (const [name, p] of Object.entries(providers)) {
        console.log(`  ${name} (${p.type}) — ${p.model || p.claudePath || 'default'}`);
      }
    }

  } else if (sub === 'remove' && args[1]) {
    const name = args[1];
    if (name === 'claude') {
      console.log('Cannot remove the default "claude" provider.');
      process.exit(1);
    }
    const config = loadConfig();
    if (!config.providers || !config.providers[name]) {
      console.log(`Provider "${name}" not found.`);
      process.exit(1);
    }
    const roles = config.roles || {};
    const usedBy = Object.entries(roles).filter(([, v]) => v === name).map(([k]) => k);
    if (usedBy.length > 0) {
      console.log(`Cannot remove "${name}" — used by roles: ${usedBy.join(', ')}`);
      console.log('Reassign those roles first with: duanju-writer role set <role> <other-provider>');
      process.exit(1);
    }
    delete config.providers[name];
    saveConfig(config);
    console.log(`Provider "${name}" removed.`);

  } else if (sub === 'test' && args[1]) {
    const name = args[1];
    const config = loadConfig();
    const providerConfig = (config.providers || {})[name];
    if (!providerConfig) {
      console.log(`Provider "${name}" not found.`);
      process.exit(1);
    }
    const { createProvider } = await import('../llm.js');
    try {
      console.log(`Testing provider "${name}"...`);
      const provider = createProvider(providerConfig);
      const response = await provider.call('Say hello in one word.');
      console.log(`Success! Response: "${response.slice(0, 100)}"`);
    } catch (err) {
      console.log(`Failed: ${err.message}`);
      process.exit(1);
    }

  } else {
    console.log('Usage: duanju-writer provider [add|list|remove|test] [name] [--flags]');
    console.log('\nExamples:');
    console.log('  duanju-writer provider add deepseek --type openai --base-url https://api.deepseek.com/v1 --model deepseek-chat --api-key sk-...');
    console.log('  duanju-writer provider list');
    console.log('  duanju-writer provider test deepseek');
    console.log('  duanju-writer provider remove deepseek');
  }
}
