import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { loadConfig, saveConfig } from './config.js';

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function setup(args) {
  const config = loadConfig();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('\nstory_writer setup\n'));

  try {
    // Step 1: Get autostory URL (or use CLI arg)
    let autostoryUrl;
    if (args[0]) {
      autostoryUrl = args[0];
    } else {
      const currentUrl = config.autostoryUrl || 'http://localhost:3001';
      const urlInput = await ask(rl, `AutoStory API URL [${currentUrl}]: `);
      autostoryUrl = urlInput.trim() || currentUrl;
    }

    // Step 2: Check API health
    console.log(chalk.dim(`\nChecking ${autostoryUrl}...`));
    try {
      const healthController = new AbortController();
      const healthTimer = setTimeout(() => healthController.abort(), 15_000);
      try {
        const healthRes = await fetch(`${autostoryUrl}/health`, { signal: healthController.signal });
        if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
      } finally {
        clearTimeout(healthTimer);
      }
      console.log(chalk.green('  API is reachable.'));
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Connection timed out (15s)' : err.message;
      console.log(chalk.red(`  Cannot reach API: ${msg}`));
      console.log(chalk.red('  Make sure the autostory API is running.'));
      process.exit(1);
    }

    // Step 3: Generate API key
    console.log(chalk.dim('\nGenerating AI API key...'));
    const keyController = new AbortController();
    const keyTimer = setTimeout(() => keyController.abort(), 15_000);
    let keyRes;
    try {
      keyRes = await fetch(`${autostoryUrl}/api/ai/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'story_writer' }),
        signal: keyController.signal,
      });
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Request timed out (15s)' : err.message;
      console.log(chalk.red(`  Failed to generate key: ${msg}`));
      process.exit(1);
    } finally {
      clearTimeout(keyTimer);
    }

    if (!keyRes.ok) {
      const err = await keyRes.json().catch(() => ({}));
      console.log(chalk.red(`  Failed to generate key: ${err.error || `HTTP ${keyRes.status}`}`));
      process.exit(1);
    }

    const { key } = await keyRes.json();
    console.log(chalk.green(`  API key generated: ${key.slice(0, 16)}...`));

    // Step 5: Save config
    config.autostoryUrl = autostoryUrl;
    config.aiApiKey = key;
    saveConfig(config);

    console.log(chalk.green('\nSetup complete! Config saved.\n'));
    console.log(chalk.dim('Run a test:'));
    console.log(chalk.dim('  node bin/story_writer.js run\n'));
    console.log(chalk.dim('Start the daemon:'));
    console.log(chalk.dim('  node bin/story_writer.js start\n'));
  } finally {
    rl.close();
  }
}
