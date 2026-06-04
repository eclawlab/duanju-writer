import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { loadConfig, saveConfig } from './config.js';

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function setup(args) {
  // Setup is interactive (URL prompt + optional existing-key prompt). When
  // stdin isn't a TTY, prompts read EOF and silently advance with empty
  // strings — which collapses through the bootstrap path with defaults the
  // user never confirmed. Reject early unless every required value can come
  // from argv (currently only the URL can — keys are generated/prompted).
  if (!process.stdin.isTTY && !args[0]) {
    console.log(chalk.red('setup requires a TTY. To run non-interactively, pass the API URL as an argument:'));
    console.log(chalk.dim('  duanju-writer setup https://your-duanju-instance.example.com'));
    process.exit(1);
  }

  const config = loadConfig();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('\nduanju-writer setup\n'));

  try {
    // Step 1: Get autostory URL (or use CLI arg)
    let autostoryUrl;
    if (args[0]) {
      autostoryUrl = args[0];
    } else {
      const currentUrl = config.autostoryUrl || 'http://localhost:3001';
      const urlInput = await ask(rl, `Duanju API URL [${currentUrl}]: `);
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
      console.log(chalk.red('  Make sure the Duanju API is running.'));
      process.exit(1);
    }

    // Step 3: Generate API key (try bootstrap first, then authenticated endpoint)
    console.log(chalk.dim('\nGenerating AI API key...'));
    let keyRes;

    // Try bootstrap endpoint first (works when no keys exist yet)
    const bootstrapController = new AbortController();
    const bootstrapTimer = setTimeout(() => bootstrapController.abort(), 15_000);
    try {
      keyRes = await fetch(`${autostoryUrl}/api/ai/keys/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'duanju-writer' }),
        signal: bootstrapController.signal,
      });
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Request timed out (15s)' : err.message;
      console.log(chalk.red(`  Failed to generate key: ${msg}`));
      process.exit(1);
    } finally {
      clearTimeout(bootstrapTimer);
    }

    // If bootstrap is disabled (keys already exist), authenticate with an
    // existing key. Reuse the already-configured key when we have one (so
    // re-running setup never re-prompts); otherwise prompt — but only when
    // stdin is a TTY, since a non-interactive prompt would throw on closed
    // readline (ERR_USE_AFTER_CLOSE).
    if (keyRes.status === 403) {
      let existingKey = (config.aiApiKey || '').trim();
      if (existingKey) {
        console.log(chalk.dim('  Keys already exist; reusing the configured API key.'));
      } else if (process.stdin.isTTY) {
        existingKey = (await ask(rl, 'API keys already exist. Enter an existing API key to generate a new one: ')).trim();
      } else {
        console.log(chalk.red('  API keys already exist, but none is configured and stdin is not a TTY.'));
        console.log(chalk.dim('  Set an existing key with: duanju-writer config set aiApiKey <key>'));
        console.log(chalk.dim('  Or re-run setup from an interactive terminal to paste one.'));
        process.exit(1);
      }
      if (!existingKey) {
        console.log(chalk.red('  No key provided. Aborting.'));
        process.exit(1);
      }
      const keyController = new AbortController();
      const keyTimer = setTimeout(() => keyController.abort(), 15_000);
      try {
        keyRes = await fetch(`${autostoryUrl}/api/ai/keys`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': existingKey,
          },
          body: JSON.stringify({ label: 'duanju-writer' }),
          signal: keyController.signal,
        });
      } catch (err) {
        const msg = err.name === 'AbortError' ? 'Request timed out (15s)' : err.message;
        console.log(chalk.red(`  Failed to generate key: ${msg}`));
        process.exit(1);
      } finally {
        clearTimeout(keyTimer);
      }
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
    console.log(chalk.dim('  node bin/duanju-writer.js run\n'));
    console.log(chalk.dim('Start the daemon:'));
    console.log(chalk.dim('  node bin/duanju-writer.js start\n'));
  } finally {
    rl.close();
  }
}
