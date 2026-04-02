#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { DATA_DIR, JOBS_DIR } from '../src/constants.js';

// Ensure data directories exist
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JOBS_DIR, { recursive: true });

const command = process.argv[2] || 'start';
const args = process.argv.slice(3);

switch (command) {
  case 'start': {
    const { startScheduler } = await import('../src/scheduler.js');
    const { startWorker } = await import('../src/worker.js');
    startScheduler();
    startWorker();
    break;
  }
  case 'scheduler': {
    const { startScheduler } = await import('../src/scheduler.js');
    startScheduler();
    break;
  }
  case 'worker': {
    const { startWorker } = await import('../src/worker.js');
    startWorker();
    break;
  }
  case 'run': {
    const { runOnce } = await import('../src/worker.js');
    const { createJob } = await import('../src/queue.js');
    // Parse count, lang, and style from args: run [count] [--lang cn|en] [--style moyan]
    let count = 1;
    let lang;
    let style;
    for (let a = 0; a < args.length; a++) {
      if (args[a] === '--lang' && args[a + 1]) {
        lang = args[a + 1].toLowerCase();
        a++;
      } else if (args[a] === '--style' && args[a + 1]) {
        style = args[a + 1].toLowerCase();
        a++;
      } else if (!isNaN(args[a]) && args[a].trim() !== '') {
        count = Math.max(0, parseInt(args[a], 10));
      }
    }
    // Validate style before creating any jobs
    if (style && style !== 'default') {
      const { getStyle } = await import('../src/styles.js');
      try {
        getStyle(style);
      } catch (err) {
        console.log(err.message);
        process.exit(1);
      }
    }
    for (let i = 0; i < count; i++) {
      const job = createJob();
      console.log(`\n[${i + 1}/${count}] Created job ${job.id}`);
      await runOnce(job.id, { lang, style });
    }
    if (count > 1) console.log(`\nFinished ${count} jobs.`);
    if (count === 0) console.log('Nothing to do (count=0).');
    break;
  }
  case 'jobs': {
    const { listJobs } = await import('../src/queue.js');
    const jobs = listJobs();
    if (jobs.length === 0) {
      console.log('No jobs.');
    } else {
      for (const j of jobs) {
        console.log(`${j.id}  ${j.status.padEnd(12)}  ${j.createdAt}  ${j.storyId || ''}`);
      }
    }
    break;
  }
  case 'config': {
    const { loadConfig, saveConfig } = await import('../src/config.js');
    const VALID_KEYS = [
      'autostoryUrl', 'aiApiKey', 'heartbeatInterval', 'claudePath',
      'maxRetries', 'maxConcurrentJobs', 'publishOnUpload', 'lang', 'style',
      'targetWordsPerScene',
    ];
    if (args[0] === 'set' && args[1]) {
      if (!VALID_KEYS.includes(args[1])) {
        console.log(`Unknown config key: ${args[1]}`);
        console.log(`Valid keys: ${VALID_KEYS.join(', ')}`);
        process.exit(1);
      }
      const config = loadConfig();
      let value = args.slice(2).join(' ');
      // Parse numbers and booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(value) && value.trim() !== '') value = Number(value);
      // Validate style values
      if (args[1] === 'style' && value !== 'default') {
        const { getStyle } = await import('../src/styles.js');
        try {
          getStyle(value);
        } catch (err) {
          console.log(err.message);
          process.exit(1);
        }
      }
      config[args[1]] = value;
      saveConfig(config);
      console.log(`Set ${args[1]} = ${JSON.stringify(value)}`);
    } else {
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
    }
    break;
  }
  case 'styles': {
    const { listStyles } = await import('../src/styles.js');
    const styles = listStyles();
    const byCategory = new Map();
    for (const s of styles) {
      const cat = s.category || 'other';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(s);
    }
    console.log('Available writing styles:\n');
    console.log('  default — Standard interactive fiction style\n');
    for (const [category, items] of byCategory) {
      console.log(`  [${category}]`);
      for (const s of items) {
        console.log(`    ${s.key} — ${s.name}`);
      }
      console.log();
    }
    console.log('Usage: story_writer run --style moyan');
    console.log('   or: story_writer config set style moyan');
    break;
  }
  case 'setup': {
    const { setup } = await import('../src/setup.js');
    await setup(args);
    break;
  }
  case 'provider': {
    const { loadConfig, saveConfig } = await import('../src/config.js');
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
      // Check if any role uses this provider
      const roles = config.roles || {};
      const usedBy = Object.entries(roles).filter(([, v]) => v === name).map(([k]) => k);
      if (usedBy.length > 0) {
        console.log(`Cannot remove "${name}" — used by roles: ${usedBy.join(', ')}`);
        console.log('Reassign those roles first with: story_writer role set <role> <other-provider>');
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
      const { createProvider } = await import('../src/llm.js');
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
      console.log('Usage: story_writer provider [add|list|remove|test] [name] [--flags]');
      console.log('\nExamples:');
      console.log('  story_writer provider add deepseek --type openai --base-url https://api.deepseek.com/v1 --model deepseek-chat --api-key sk-...');
      console.log('  story_writer provider list');
      console.log('  story_writer provider test deepseek');
      console.log('  story_writer provider remove deepseek');
    }
    break;
  }
  case 'role': {
    const { loadConfig, saveConfig } = await import('../src/config.js');
    const sub = args[0];
    const VALID_ROLES = ['research', 'outline', 'plan', 'scene', 'compress', 'consistency', 'style', 'repair'];

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
        console.log(`Provider "${provider}" not found. Add it first with: story_writer provider add ${provider} ...`);
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
      console.log('Usage: story_writer role [set|list]');
      console.log('\nExamples:');
      console.log('  story_writer role list');
      console.log('  story_writer role set scene deepseek');
    }
    break;
  }
  case 'knowledge': {
  const sub = args[0];

  if (sub === 'import' && args[1]) {
    const { statSync } = await import('node:fs');
    const { createStore } = await import('../src/vectorstore.js');
    const { importDocument, importDirectory } = await import('../src/knowledge.js');
    const { loadConfig } = await import('../src/config.js');
    const target = args[1];

    // Determine store path — use --job flag or default global store
    let storePath;
    const jobIdx = args.indexOf('--job');
    if (jobIdx !== -1 && args[jobIdx + 1]) {
      const { JOBS_DIR } = await import('../src/constants.js');
      const { join } = await import('node:path');
      storePath = join(JOBS_DIR, args[jobIdx + 1], 'vectorstore.json');
    } else {
      storePath = (await import('node:path')).join(DATA_DIR, 'knowledge.json');
    }

    const store = createStore(storePath);
    store.load();

    try {
      const stat = statSync(target);
      if (stat.isDirectory()) {
        const result = await importDirectory(store, target);
        store.save();
        console.log(`Imported ${result.files} files (${result.totalChunks} chunks) into knowledge base`);
      } else {
        const result = await importDocument(store, target);
        store.save();
        console.log(`Imported "${target}" (${result.chunks} chunks) into knowledge base`);
      }
    } catch (err) {
      console.log(`Failed to import: ${err.message}`);
      process.exit(1);
    }

  } else if (sub === 'clear') {
    const { createStore } = await import('../src/vectorstore.js');

    let storePath;
    const jobIdx = args.indexOf('--job');
    if (jobIdx !== -1 && args[jobIdx + 1]) {
      const { JOBS_DIR } = await import('../src/constants.js');
      const { join } = await import('node:path');
      storePath = join(JOBS_DIR, args[jobIdx + 1], 'vectorstore.json');
    } else {
      storePath = (await import('node:path')).join(DATA_DIR, 'knowledge.json');
    }

    const store = createStore(storePath);
    store.clear();
    console.log('Knowledge base cleared.');

  } else if (sub === 'info') {
    const { createStore } = await import('../src/vectorstore.js');

    let storePath;
    const jobIdx = args.indexOf('--job');
    if (jobIdx !== -1 && args[jobIdx + 1]) {
      const { JOBS_DIR } = await import('../src/constants.js');
      const { join } = await import('node:path');
      storePath = join(JOBS_DIR, args[jobIdx + 1], 'vectorstore.json');
    } else {
      storePath = (await import('node:path')).join(DATA_DIR, 'knowledge.json');
    }

    const store = createStore(storePath);
    store.load();
    console.log(`Knowledge base: ${store.size()} entries`);
    console.log(`Store path: ${storePath}`);

  } else {
    console.log('Usage: story_writer knowledge [import|clear|info] [path] [--job jobId]');
    console.log('\nExamples:');
    console.log('  story_writer knowledge import ./my-worldbuilding.txt');
    console.log('  story_writer knowledge import ./reference-docs/');
    console.log('  story_writer knowledge info');
    console.log('  story_writer knowledge clear');
  }
  break;
}
  default:
    console.log(`Unknown command: ${command}`);
    console.log('Usage: story_writer [setup|start|scheduler|worker|run|jobs|styles|config|provider|role|knowledge]');
    process.exit(1);
}
