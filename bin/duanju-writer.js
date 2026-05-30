#!/usr/bin/env node

import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
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

const command = process.argv[2];
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
    const inFlight = jobs.filter(j => ['extracting', 'collecting', 'writing', 'uploading'].includes(j.status));
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

function printUsage() {
  console.log('Usage: duanju-writer [setup|start|scheduler|worker|run|modify|stories|jobs|styles|author-styles|config|provider|role|knowledge|resume]');
  console.log('\nRun options: duanju-writer run [count] [--lang cn] [--style 战神归来] [--type 都市] [--news URL] [--story path.{txt,md}] [--fidelity tight|medium|loose] [--character path.md] [--event path.md] [--model claude|openai] [--episodes N] [--clips-per-episode K] [--mode default|selftell] [--author-style <作家名>] [--no-publish]');
  console.log('\nModify options: duanju-writer modify <storyId> --feedback "..." [--feedback-file path] [--lang cn] [--model <provider>] [--title "..."] [--dry-run]');
}

// No subcommand (bare `duanju-writer`) must NOT silently launch the daemon —
// show usage and exit. The daemon is only started via explicit `start`.
if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

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
    const { parseRunFlags } = await import('../src/cli.js');
    const parsed = parseRunFlags(args);
    if (!parsed.ok) { console.log(parsed.error); process.exit(1); }
    const { count } = parsed;
    const {
      lang, style, genre, newsUrl, characterPath, eventPath, storyPath,
      fidelity: fidelityOpt, model, episodesPerDrama, clipsPerEpisode,
      mode, authorStyle, publish,
    } = parsed.opts;
    // fidelity may be reassigned below (defaulted from config when --story is
    // set without --fidelity), so it needs a mutable binding.
    let fidelity = fidelityOpt;
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
    // Resolve --story / --fidelity
    let referenceStory;
    {
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig();
      const MAX_STORY_BYTES = 1_000_000;
      const VALID_FIDELITY = ['tight', 'medium', 'loose'];
      const effectiveStoryPath = storyPath || config.referenceStory;
      if (effectiveStoryPath) {
        if (newsUrl) {
          console.error('Error: --story and --news are mutually exclusive (cannot be used together).');
          process.exit(1);
        }
        if (style && style !== 'default') {
          console.error('Error: --story and --style are mutually exclusive (cannot be used together).');
          process.exit(1);
        }
        let st;
        try { st = statSync(effectiveStoryPath); }
        catch (err) {
          console.error(`Error: --story file unreadable or missing: ${effectiveStoryPath} (${err.message})`);
          process.exit(1);
        }
        if (st.size > MAX_STORY_BYTES) {
          console.error(`Error: --story file too large: ${st.size} bytes > 1MB limit`);
          process.exit(1);
        }
        try { referenceStory = readFileSync(effectiveStoryPath, 'utf8'); }
        catch (err) {
          console.error(`Error: --story file unreadable: ${err.message}`);
          process.exit(1);
        }
        if (!referenceStory.trim()) {
          console.error('Error: --story file is empty.');
          process.exit(1);
        }
        console.log(`Using reference story from: ${effectiveStoryPath} (${referenceStory.length} chars)`);
      }
      if (fidelity) {
        if (!effectiveStoryPath) {
          console.error('Error: --fidelity requires --story (or referenceStory in config).');
          process.exit(1);
        }
        if (!VALID_FIDELITY.includes(fidelity)) {
          console.error(`Error: --fidelity must be one of tight, medium, loose (got "${fidelity}").`);
          process.exit(1);
        }
      } else {
        fidelity = config.fidelity || 'medium';
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
    // Validate author style before creating any jobs (orthogonal to --style).
    if (authorStyle && authorStyle !== 'default') {
      const { getAuthorStyle } = await import('../src/author-styles.js');
      try {
        getAuthorStyle(authorStyle);
      } catch (err) {
        console.log(err.message);
        process.exit(1);
      }
    }
    // Validate and set model override
    if (model) {
      const { loadConfig } = await import('../src/config.js');
      const { resolveModelOverride } = await import('../src/cli.js');
      const res = resolveModelOverride(model, loadConfig());
      if (!res.ok) { console.log(res.error); process.exit(1); }
      const { setModelOverride } = await import('../src/llm.js');
      setModelOverride(model);
      console.log(`Using model: ${res.label}`);
    }
    for (let i = 0; i < count; i++) {
      const job = createJob({ lang, style, genre, newsUrl, referenceCharacter, referenceEvent, referenceStory, fidelity, episodesPerDrama, clipsPerEpisode, mode, authorStyle, publish });
      console.log(`\n[${i + 1}/${count}] Created job ${job.id}`);
      await runOnce(job.id, { lang, style, genre, newsUrl, referenceCharacter, referenceEvent, referenceStory, fidelity, episodesPerDrama, clipsPerEpisode, mode, authorStyle, publish });
    }
    if (count > 1) console.log(`\nFinished ${count} jobs.`);
    if (count === 0) console.log('Nothing to do (count=0).');
    break;
  }
  case 'modify': {
    // Modify & improve: download an existing usaduanju.com novel, apply small
    // feedback-driven edits, re-upload as a NEW standalone novel.
    //   modify <storyId> --feedback "..." | --feedback-file path
    //          [--lang cn] [--model <provider>] [--title "..."] [--dry-run]
    let storyId;
    let feedback;
    let feedbackFile;
    let lang;
    let model;
    let title;
    let dryRun = false;
    {
      const { parseFlags } = await import('../src/cli.js');
      const parsed = parseFlags(args, {
        feedback: { type: 'string' },
        'feedback-file': { type: 'string' },
        lang: { type: 'string' },
        model: { type: 'string' },
        title: { type: 'string' },
        'dry-run': { type: 'boolean' },
      });
      if (parsed.errors.length) { console.error(`Error: ${parsed.errors[0]}`); process.exit(1); }
      storyId = parsed.positionals[0];
      feedback = parsed.values.feedback;
      feedbackFile = parsed.values['feedback-file'];
      model = parsed.values.model;
      title = parsed.values.title;
      dryRun = !!parsed.values['dry-run'];
      if (parsed.values.lang !== undefined) {
        lang = parsed.values.lang.toLowerCase();
        if (lang !== 'cn') { console.log(`--lang ${parsed.values.lang} is not supported (CN only).`); process.exit(1); }
      }
    }
    if (!storyId) {
      console.log('Usage: duanju-writer modify <storyId> --feedback "..." [--feedback-file path] [--lang cn] [--model <provider>] [--title "..."] [--dry-run]');
      console.log('Tip: run `duanju-writer stories` to list published novels and their storyIds.');
      process.exit(1);
    }
    if (feedback && feedbackFile) {
      console.error('Error: --feedback and --feedback-file are mutually exclusive.');
      process.exit(1);
    }
    if (feedbackFile) {
      try {
        feedback = readFileSync(feedbackFile, 'utf8');
      } catch (err) {
        console.error(`Error: --feedback-file unreadable: ${err.message}`);
        process.exit(1);
      }
    }
    if (!feedback || !feedback.trim()) {
      console.error('Error: feedback is required (--feedback "..." or --feedback-file path).');
      process.exit(1);
    }
    if (model) {
      const { loadConfig } = await import('../src/config.js');
      const { resolveModelOverride } = await import('../src/cli.js');
      const res = resolveModelOverride(model, loadConfig());
      if (!res.ok) { console.log(res.error); process.exit(1); }
      const { setModelOverride } = await import('../src/llm.js');
      setModelOverride(model);
      console.log(`Using model: ${res.label}`);
    }
    const { modifyStory } = await import('../src/modifier.js');
    try {
      const result = await modifyStory({
        storyId, feedback, lang, title, dryRun,
        log: (msg) => console.log(`  ${msg}`),
      });
      if (result.newStoryId) {
        console.log(`\nModified novel published as new story: ${result.newStoryId}`);
      } else {
        console.log(`\nDry run complete — no upload. Review artifacts in ${result.artifactDir}`);
      }
    } catch (err) {
      console.error(`Modify failed: ${err.message}`);
      process.exit(1);
    }
    break;
  }
  case 'resume': {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const flag = join(DATA_DIR, 'resume.flag');
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(flag, new Date().toISOString());
    console.log(`Resume signal written to ${flag}`);
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
  case 'stories': {
    // List novels published to usaduanju.com from this machine, so you know
    // which storyId to pass to `modify`. Optional substring query filters by
    // title / storyId / jobId.
    const { listPublishedStories, filterPublishedStories } = await import('../src/published.js');
    const query = args.find((a) => !a.startsWith('--'));
    const rows = filterPublishedStories(listPublishedStories(), query);
    if (rows.length === 0) {
      console.log(query
        ? `No published stories match "${query}".`
        : 'No published stories found yet. Run `duanju-writer run` to create some.');
      break;
    }
    console.log(`${rows.length} published novel(s)${query ? ` matching "${query}"` : ''}:\n`);
    for (const r of rows) {
      const label = r.variationLabel ? ` · ${r.variationLabel}` : '';
      console.log(`  ${r.storyId}  ${r.title}${label}`);
    }
    console.log('\nModify one with: duanju-writer modify <storyId> --feedback "..."');
    break;
  }
  case 'config': {
    const { loadConfig, saveConfig } = await import('../src/config.js');
    const VALID_KEYS = [
      'autostoryUrl', 'aiApiKey', 'heartbeatInterval', 'claudePath',
      'maxRetries', 'publish', 'publishOnUpload', 'uploadTimeout', 'lang', 'genre',
      'referenceCharacter', 'referenceEvent', 'referenceStory', 'fidelity', 'style',
      'targetCharsPerClip', 'episodesPerDrama', 'clipsPerEpisode',
      'mode', 'authorStyle',
    ];
    if (args[0] === 'set' && args[1]) {
      if (!VALID_KEYS.includes(args[1])) {
        if (args[1] === 'novelType') {
          console.log(`'novelType' has been renamed to 'genre'. Use: duanju-writer config set genre <value>`);
        } else if (args[1] === 'targetWordsPerScene') {
          console.log(`'targetWordsPerScene' has been renamed to 'targetCharsPerClip'. Use: duanju-writer config set targetCharsPerClip <value>`);
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
      // Validate mode values — mirror the --mode CLI flag's allowlist.
      if (args[1] === 'mode' && value !== 'default' && value !== 'selftell') {
        console.log(`Invalid mode "${value}". Supported: default, selftell.`);
        process.exit(1);
      }
      // Numeric range validation — mirror the bounds the CLI flags enforce so
      // `config set` can't smuggle out-of-range values past them.
      const NUMERIC_RANGES = {
        episodesPerDrama: [10, 40],
        clipsPerEpisode: [4, 10],
        maxRetries: [0, 10],
        targetCharsPerClip: [0, 500],
        uploadTimeout: [1000, 600000],
        heartbeatInterval: [60000, 86400000],
      };
      if (NUMERIC_RANGES[args[1]]) {
        const [min, max] = NUMERIC_RANGES[args[1]];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
          console.log(`Invalid ${args[1]} "${args.slice(2).join(' ')}". Must be a number in [${min}, ${max}].`);
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
  case 'author-styles': {
    const { listAuthorStyles } = await import('../src/author-styles.js');
    const styles = listAuthorStyles();
    const byCategory = new Map();
    for (const s of styles) {
      const cat = s.category || 'other';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(s);
    }
    console.log('Available author voices (--author-style):\n');
    console.log('  default — no author voice (plot/trope only)\n');
    for (const [category, items] of byCategory) {
      console.log(`  [${category}]`);
      for (const s of items) {
        console.log(`    ${s.name}  (key: ${s.key})`);
      }
      console.log();
    }
    console.log('Usage: duanju-writer run --author-style 莫言   (the key "moyan" also works)');
    console.log('Note: orthogonal to --style and --story (can be combined).');
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
    console.log('Usage: duanju-writer run --style 战神归来');
    console.log('   or: duanju-writer config set style 战神归来');
    break;
  }
  case 'setup': {
    const { setup } = await import('../src/setup.js');
    await setup(args);
    break;
  }
  case 'provider': {
    const { handleProvider } = await import('../src/commands/provider.js');
    await handleProvider(args);
    break;
  }
  case 'role': {
    const { handleRole } = await import('../src/commands/role.js');
    await handleRole(args);
    break;
  }
  case 'knowledge': {
    const { handleKnowledge } = await import('../src/commands/knowledge.js');
    await handleKnowledge(args);
    break;
  }
  default:
    console.log(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
