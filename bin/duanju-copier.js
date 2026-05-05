#!/usr/bin/env node

import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { DATA_DIR, JOBS_DIR } from '../src/constants.js';
import { cleanupStale, registerParent, unregisterParent } from '../src/pidfile.js';

// Load .env file if present (no dependency needed)
const envPath = new URL('../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// Ensure data directories exist
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JOBS_DIR, { recursive: true });

const command = process.argv[2] || 'start';
const args = process.argv.slice(3);

function installShutdown(services) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal} — shutting down...`);
    for (const svc of services) {
      try { svc?.stop?.(); } catch {}
    }
    try { unregisterParent(process.pid); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function startupCleanup({ fresh = false } = {}) {
  const result = cleanupStale();
  if (result.killed.length > 0) {
    console.log(`Terminated ${result.killed.length} orphan process(es) from prior run: ${result.killed.join(', ')}`);
  }
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} stale PID(s) that no longer match expected signature: ${result.skipped.join(', ')}`);
  }
  if (fresh) {
    // Explicit opt-in wipe. Without --fresh the daemon resumes from per-job
    // artifacts (front.progress.json, story.{key}.progress.json, etc.) — the
    // whole point of those files is that a daemon restart should NOT lose
    // partially-generated dramas (30+ minutes of LLM time per job).
    const { resetJobs } = await import('../src/queue.js');
    const { priorCount } = resetJobs();
    if (priorCount > 0) {
      console.log(`Fresh start — cleared ${priorCount} prior job(s) and their artifacts.`);
    }
  } else {
    const { listJobs } = await import('../src/queue.js');
    const jobs = listJobs();
    const inFlight = jobs.filter(j => ['collecting', 'writing', 'uploading'].includes(j.status));
    const pending = jobs.filter(j => j.status === 'pending');
    if (inFlight.length > 0 || pending.length > 0) {
      console.log(`Resuming with ${inFlight.length} in-flight + ${pending.length} pending job(s). Pass --fresh to discard them.`);
    }
  }
  registerParent(process.pid);
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

const fresh = hasFlag(args, '--fresh');

switch (command) {
  case 'start': {
    await startupCleanup({ fresh });
    const { startScheduler } = await import('../src/scheduler.js');
    const { startWorker } = await import('../src/worker.js');
    const scheduler = startScheduler();
    const worker = startWorker();
    installShutdown([scheduler, worker]);
    break;
  }
  case 'scheduler': {
    await startupCleanup({ fresh });
    const { startScheduler } = await import('../src/scheduler.js');
    const scheduler = startScheduler();
    installShutdown([scheduler]);
    break;
  }
  case 'worker': {
    await startupCleanup({ fresh });
    const { startWorker } = await import('../src/worker.js');
    const worker = startWorker();
    installShutdown([worker]);
    break;
  }
  case 'run': {
    const { runOnce } = await import('../src/worker.js');
    const { createJob } = await import('../src/queue.js');
    // Parse count, lang, style, type, news, character, event, model, episodes, clips-per-episode from args
    // run [count] [--lang cn] [--style 战神归来] [--type 都市] [--news URL] [--character path.md] [--event path.md]
    //     [--model claude|openai|<provider>] [--episodes N] [--clips-per-episode K]
    let count = 1;
    let lang;
    let style;
    let genre;
    let newsUrl;
    let characterPath;
    let eventPath;
    let model;
    let episodesPerDrama;
    let clipsPerEpisode;
    for (let a = 0; a < args.length; a++) {
      if (args[a] === '--lang' && args[a + 1]) {
        lang = args[a + 1].toLowerCase();
        if (lang !== 'cn') {
          console.log(`--lang ${args[a + 1]} is not supported (CN only).`);
          process.exit(1);
        }
        a++;
      } else if (args[a] === '--style' && args[a + 1]) {
        style = args[a + 1];
        a++;
      } else if (args[a] === '--type' && args[a + 1]) {
        genre = args[a + 1];
        a++;
      } else if (args[a] === '--news' && args[a + 1]) {
        newsUrl = args[a + 1];
        a++;
      } else if (args[a] === '--character' && args[a + 1]) {
        characterPath = args[a + 1];
        a++;
      } else if (args[a] === '--event' && args[a + 1]) {
        eventPath = args[a + 1];
        a++;
      } else if (args[a] === '--model' && args[a + 1]) {
        model = args[a + 1];
        a++;
      } else if (args[a] === '--episodes' && args[a + 1]) {
        const n = Number(args[a + 1]);
        if (!Number.isInteger(n) || n < 10 || n > 40) {
          console.log(`--episodes must be an integer in [10, 40], got: ${args[a + 1]}`);
          process.exit(1);
        }
        episodesPerDrama = n;
        a++;
      } else if (args[a] === '--clips-per-episode' && args[a + 1]) {
        const k = Number(args[a + 1]);
        if (!Number.isInteger(k) || k < 4 || k > 10) {
          console.log(`--clips-per-episode must be an integer in [4, 10], got: ${args[a + 1]}`);
          process.exit(1);
        }
        clipsPerEpisode = k;
        a++;
      } else if (!isNaN(args[a]) && args[a].trim() !== '') {
        count = Math.max(0, parseInt(args[a], 10));
      }
    }
    // Resolve reference character + event: CLI flag takes precedence, else config path
    let referenceCharacter;
    let referenceEvent;
    {
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig();
      const charRefPath = characterPath || config.referenceCharacter;
      if (charRefPath) {
        try {
          referenceCharacter = readFileSync(charRefPath, 'utf8');
          if (!referenceCharacter.trim()) {
            console.log(`Reference character file "${charRefPath}" is empty.`);
            process.exit(1);
          }
          console.log(`Using reference character from: ${charRefPath} (${referenceCharacter.length} chars)`);
        } catch (err) {
          console.log(`Failed to read character file "${charRefPath}": ${err.message}`);
          process.exit(1);
        }
      }
      const eventRefPath = eventPath || config.referenceEvent;
      if (eventRefPath) {
        try {
          referenceEvent = readFileSync(eventRefPath, 'utf8');
          if (!referenceEvent.trim()) {
            console.log(`Reference event file "${eventRefPath}" is empty.`);
            process.exit(1);
          }
          console.log(`Using reference event from: ${eventRefPath} (${referenceEvent.length} chars)`);
        } catch (err) {
          console.log(`Failed to read event file "${eventRefPath}": ${err.message}`);
          process.exit(1);
        }
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
    // Validate and set model override
    if (model) {
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig();
      if (!config.providers || !config.providers[model]) {
        console.log(`Provider "${model}" not found.`);
        console.log(`Available providers: ${Object.keys(config.providers || {}).join(', ')}`);
        console.log('Add one with: duanju-copier provider add <name> --type openai ...');
        process.exit(1);
      }
      // Check OpenAI providers have an API key configured
      const providerCfg = config.providers[model];
      if (providerCfg.type === 'openai' && !providerCfg.apiKey) {
        console.log(`Provider "${model}" has no API key configured.`);
        console.log(`Set it with: duanju-copier provider add ${model} --type openai --base-url ${providerCfg.baseUrl} --model ${providerCfg.model} --api-key <your-key>`);
        process.exit(1);
      }
      const { setModelOverride } = await import('../src/llm.js');
      setModelOverride(model);
      console.log(`Using model: ${model} (${providerCfg.type}, ${providerCfg.model || providerCfg.claudePath || 'default'})`);
    }
    for (let i = 0; i < count; i++) {
      const job = createJob({ lang, style, genre, newsUrl, referenceCharacter, referenceEvent, episodesPerDrama, clipsPerEpisode });
      console.log(`\n[${i + 1}/${count}] Created job ${job.id}`);
      await runOnce(job.id, { lang, style, genre, newsUrl, referenceCharacter, referenceEvent, episodesPerDrama, clipsPerEpisode });
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
      'maxRetries', 'publishOnUpload', 'lang', 'genre',
      'referenceCharacter', 'referenceEvent', 'style',
      'targetCharsPerClip', 'episodesPerDrama', 'clipsPerEpisode',
    ];
    if (args[0] === 'set' && args[1]) {
      if (!VALID_KEYS.includes(args[1])) {
        if (args[1] === 'novelType') {
          console.log(`'novelType' has been renamed to 'genre'. Use: duanju-copier config set genre <value>`);
        } else if (args[1] === 'targetWordsPerScene') {
          console.log(`'targetWordsPerScene' has been renamed to 'targetCharsPerClip'. Use: duanju-copier config set targetCharsPerClip <value>`);
        } else {
          console.log(`Unknown config key: ${args[1]}`);
          console.log(`Valid keys: ${VALID_KEYS.join(', ')}`);
        }
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
      // Validate lang values
      if (args[1] === 'lang' && value !== 'cn') {
        console.log(`Invalid lang "${value}". Only 'cn' is supported.`);
        process.exit(1);
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
    console.log('Available 短剧 tropes:\n');
    console.log('  default — Use materials/snowflake-derived theme without a fixed trope\n');
    for (const [category, items] of byCategory) {
      console.log(`  [${category}]`);
      for (const s of items) {
        console.log(`    ${s.key} — ${s.name}`);
      }
      console.log();
    }
    console.log('Usage: duanju-copier run --style 战神归来');
    console.log('   or: duanju-copier config set style 战神归来');
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
        console.log('Reassign those roles first with: duanju-copier role set <role> <other-provider>');
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
      console.log('Usage: duanju-copier provider [add|list|remove|test] [name] [--flags]');
      console.log('\nExamples:');
      console.log('  duanju-copier provider add deepseek --type openai --base-url https://api.deepseek.com/v1 --model deepseek-chat --api-key sk-...');
      console.log('  duanju-copier provider list');
      console.log('  duanju-copier provider test deepseek');
      console.log('  duanju-copier provider remove deepseek');
    }
    break;
  }
  case 'role': {
    const { loadConfig, saveConfig } = await import('../src/config.js');
    const sub = args[0];
    const VALID_ROLES = ['research', 'outline', 'tail-outline', 'plan', 'clip', 'compress', 'consistency', 'style', 'repair'];

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
        console.log(`Provider "${provider}" not found. Add it first with: duanju-copier provider add ${provider} ...`);
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
      console.log('Usage: duanju-copier role [set|list]');
      console.log('\nExamples:');
      console.log('  duanju-copier role list');
      console.log('  duanju-copier role set scene deepseek');
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
    console.log('Usage: duanju-copier knowledge [import|clear|info] [path] [--job jobId]');
    console.log('\nExamples:');
    console.log('  duanju-copier knowledge import ./my-worldbuilding.txt');
    console.log('  duanju-copier knowledge import ./reference-docs/');
    console.log('  duanju-copier knowledge info');
    console.log('  duanju-copier knowledge clear');
  }
  break;
}
  default:
    console.log(`Unknown command: ${command}`);
    console.log('Usage: duanju-copier [setup|start|scheduler|worker|run|jobs|styles|config|provider|role|knowledge]');
    console.log('\nRun options: duanju-copier run [count] [--lang cn] [--style 战神归来] [--type 都市] [--news URL] [--character path.md] [--event path.md] [--model claude|openai] [--episodes N] [--clips-per-episode K]');
    process.exit(1);
}
