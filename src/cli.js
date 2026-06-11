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
 * Parse + validate the `run` subcommand's args. Pure: returns a result the
 * caller prints/exits on, instead of calling process.exit itself (so it's
 * unit-testable). Preserves the original behavior: a single non-negative
 * integer positional count, value-flags, the `--no-publish` boolean, and the
 * per-flag range/enum validation. Unknown flags are reported as errors.
 *
 * @returns {{ ok: boolean, error?: string, count?: number, opts?: object }}
 */
export function parseRunFlags(args) {
  const { values, positionals, errors } = parseFlags(args, {
    lang: { type: 'string' },
    style: { type: 'string' },
    type: { type: 'string' },          // CLI flag name; maps to `genre`
    news: { type: 'string' },
    character: { type: 'string' },
    event: { type: 'string' },
    story: { type: 'string' },
    fidelity: { type: 'string' },
    model: { type: 'string' },
    episodes: { type: 'string' },
    'clips-per-episode': { type: 'string' },
    mode: { type: 'string' },
    'author-style': { type: 'string' },
    'no-publish': { type: 'boolean' },
    'rich-context': { type: 'boolean' },
    'no-rich-context': { type: 'boolean' },
  });
  if (errors.length) return { ok: false, error: errors[0] };

  // Positional count: at most one, plain non-negative integer digits only.
  if (positionals.length > 1) {
    return { ok: false, error: `run accepts a single count; got a second one: ${positionals[1]}` };
  }
  let count = 1;
  if (positionals.length === 1) {
    const p = positionals[0].trim();
    if (!/^\d+$/.test(p)) {
      return { ok: false, error: `run count must be a non-negative integer, got: ${positionals[0]}` };
    }
    count = Number(p);
  }

  const opts = {};
  if (values.lang !== undefined) {
    opts.lang = values.lang.toLowerCase();
    if (opts.lang !== 'cn' && opts.lang !== 'en') return { ok: false, error: `--lang ${values.lang} is not supported (cn or en).` };
  }
  if (values.style !== undefined) opts.style = values.style;
  if (values.type !== undefined) opts.genre = values.type;
  if (values.news !== undefined) opts.newsUrl = values.news;
  if (values.character !== undefined) opts.characterPath = values.character;
  if (values.event !== undefined) opts.eventPath = values.event;
  if (values.story !== undefined) opts.storyPath = values.story;
  if (values.fidelity !== undefined) opts.fidelity = values.fidelity;
  if (values.model !== undefined) opts.model = values.model;
  if (values.episodes !== undefined) {
    const n = Number(values.episodes);
    if (!Number.isInteger(n) || n < 10 || n > 40) {
      return { ok: false, error: `--episodes must be an integer in [10, 40], got: ${values.episodes}` };
    }
    opts.episodesPerDrama = n;
  }
  if (values['clips-per-episode'] !== undefined) {
    const k = Number(values['clips-per-episode']);
    if (!Number.isInteger(k) || k < 4 || k > 10) {
      return { ok: false, error: `--clips-per-episode must be an integer in [4, 10], got: ${values['clips-per-episode']}` };
    }
    opts.clipsPerEpisode = k;
  }
  if (values.mode !== undefined) {
    const m = values.mode.toLowerCase();
    if (m !== 'default' && m !== 'selftell') {
      return { ok: false, error: `Unknown mode: "${m}". Supported: default, selftell.` };
    }
    opts.mode = m;
  }
  if (values['author-style'] !== undefined) opts.authorStyle = values['author-style'];
  if (values['no-publish']) opts.publish = false;
  // --rich-context / --no-rich-context override the config default. If both are
  // passed, the explicit disable wins (safer / matches --no-* convention).
  if (values['rich-context']) opts.richContext = true;
  if (values['no-rich-context']) opts.richContext = false;

  return { ok: true, count, opts };
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
