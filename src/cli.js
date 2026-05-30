// Small CLI helpers shared by bin/duanju-writer.js subcommands.

/**
 * Generic flag parser. Walks argv once against a spec and returns parsed
 * values, leftover positionals, and any errors (the caller decides how to
 * report/exit). Pure and synchronous so it's unit-testable.
 *
 * spec: { [flag: string]: { type: 'string'|'boolean', alias?: string } }
 *   - 'string' flags consume the next argv token as their value.
 *   - 'boolean' flags are presence-only (no value consumed).
 * Flags are matched with a leading '--' (e.g. spec key 'lang' matches '--lang').
 *
 * @returns {{ values: object, positionals: string[], errors: string[] }}
 */
export function parseFlags(args, spec) {
  const values = {};
  const positionals = [];
  const errors = [];
  // Build a lookup from '--name' to its spec entry + canonical key.
  const lookup = new Map();
  for (const [key, def] of Object.entries(spec)) {
    lookup.set(`--${key}`, { key, ...def });
    if (def.alias) lookup.set(`--${def.alias}`, { key, ...def });
  }
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    const def = lookup.get(tok);
    if (def) {
      if (def.type === 'boolean') {
        values[def.key] = true;
      } else {
        const val = args[i + 1];
        if (val === undefined) {
          errors.push(`Flag ${tok} requires a value.`);
        } else {
          values[def.key] = val;
          i++;
        }
      }
    } else if (tok.startsWith('--')) {
      errors.push(`Unknown flag: ${tok}`);
    } else {
      positionals.push(tok);
    }
  }
  return { values, positionals, errors };
}

/**
 * Validate that a named provider exists and is usable as a model override.
 * Pure (config injected); returns a result instead of calling process.exit so
 * it's testable. The caller applies setModelOverride + reports.
 *
 * @param {string} model - provider name
 * @param {object} config - loaded config (with .providers)
 * @returns {{ ok: boolean, label?: string, error?: string }}
 */
export function resolveModelOverride(model, config) {
  const providers = config.providers || {};
  if (!providers[model]) {
    const available = Object.keys(providers).join(', ');
    return {
      ok: false,
      error: `Provider "${model}" not found.\nAvailable providers: ${available}\n`
        + `Add one with: duanju-writer provider add <name> --type openai ...`,
    };
  }
  const providerCfg = providers[model];
  if (providerCfg.type === 'openai' && !providerCfg.apiKey) {
    return {
      ok: false,
      error: `Provider "${model}" has no API key configured.\n`
        + `Set it with: duanju-writer provider add ${model} --type openai `
        + `--base-url ${providerCfg.baseUrl || '<url>'} --model ${providerCfg.model || '<model>'} --api-key <your-key>`,
    };
  }
  return {
    ok: true,
    label: `${model} (${providerCfg.type}, ${providerCfg.model || providerCfg.claudePath || 'default'})`,
  };
}
