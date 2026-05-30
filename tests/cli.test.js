import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags, resolveModelOverride } from '../src/cli.js';

test('parseFlags: string flags consume next token, booleans do not', () => {
  const r = parseFlags(['--feedback', 'hello world', '--dry-run', 'story123'], {
    feedback: { type: 'string' },
    'dry-run': { type: 'boolean' },
  });
  assert.equal(r.values.feedback, 'hello world');
  assert.equal(r.values['dry-run'], true);
  assert.deepEqual(r.positionals, ['story123']);
  assert.deepEqual(r.errors, []);
});

test('parseFlags: missing value for string flag is an error', () => {
  const r = parseFlags(['--feedback'], { feedback: { type: 'string' } });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /requires a value/);
});

test('parseFlags: unknown flag is an error', () => {
  const r = parseFlags(['--bogus', 'x'], { feedback: { type: 'string' } });
  assert.match(r.errors[0], /Unknown flag: --bogus/);
});

test('parseFlags: positionals collected in order', () => {
  const r = parseFlags(['a', '--n', 'b'], { n: { type: 'string' } });
  assert.deepEqual(r.positionals, ['a']);
  assert.equal(r.values.n, 'b');
});

test('resolveModelOverride: unknown provider', () => {
  const r = resolveModelOverride('nope', { providers: { claude: { type: 'claude-cli' } } });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});

test('resolveModelOverride: openai provider without key', () => {
  const r = resolveModelOverride('ds', { providers: { ds: { type: 'openai', baseUrl: 'u', model: 'm', apiKey: '' } } });
  assert.equal(r.ok, false);
  assert.match(r.error, /no API key/);
});

test('resolveModelOverride: valid provider returns label', () => {
  const r = resolveModelOverride('ds', { providers: { ds: { type: 'openai', baseUrl: 'u', model: 'deepseek-chat', apiKey: 'k' } } });
  assert.equal(r.ok, true);
  assert.match(r.label, /ds \(openai, deepseek-chat\)/);
});

test('resolveModelOverride: claude-cli provider label uses claudePath', () => {
  const r = resolveModelOverride('claude', { providers: { claude: { type: 'claude-cli', claudePath: 'claude' } } });
  assert.equal(r.ok, true);
  assert.match(r.label, /claude-cli/);
});

import { parseRunFlags } from '../src/cli.js';

test('parseRunFlags: defaults to count=1, empty opts', () => {
  const r = parseRunFlags([]);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.deepEqual(r.opts, {});
});

test('parseRunFlags: maps --type to genre and --no-publish to publish:false', () => {
  const r = parseRunFlags(['3', '--type', '都市', '--no-publish']);
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  assert.equal(r.opts.genre, '都市');
  assert.equal(r.opts.publish, false);
});

test('parseRunFlags: validates episodes range', () => {
  assert.match(parseRunFlags(['--episodes', '99']).error, /\[10, 40\]/);
  assert.equal(parseRunFlags(['--episodes', '20']).opts.episodesPerDrama, 20);
});

test('parseRunFlags: validates clips-per-episode range', () => {
  assert.match(parseRunFlags(['--clips-per-episode', '1']).error, /\[4, 10\]/);
  assert.equal(parseRunFlags(['--clips-per-episode', '6']).opts.clipsPerEpisode, 6);
});

test('parseRunFlags: rejects non-cn lang and bad count and second count', () => {
  assert.match(parseRunFlags(['--lang', 'en']).error, /CN only/);
  assert.match(parseRunFlags(['abc']).error, /non-negative integer/);
  assert.match(parseRunFlags(['1', '2']).error, /single count/);
});

test('parseRunFlags: mode allowlist + author-style + paths', () => {
  assert.match(parseRunFlags(['--mode', 'weird']).error, /Supported: default, selftell/);
  const r = parseRunFlags(['--mode', 'selftell', '--author-style', '莫言', '--story', 's.txt']);
  assert.equal(r.opts.mode, 'selftell');
  assert.equal(r.opts.authorStyle, '莫言');
  assert.equal(r.opts.storyPath, 's.txt');
});

test('parseRunFlags: unknown flag errors', () => {
  assert.match(parseRunFlags(['--bogus']).error, /Unknown flag/);
});
