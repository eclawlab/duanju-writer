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
  default:
    console.log(`Unknown command: ${command}`);
    console.log('Usage: story_writer [setup|start|scheduler|worker|run [count] [--lang cn|en] [--style moyan]|jobs|styles|config]');
    process.exit(1);
}
