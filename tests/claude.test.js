import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('claude', () => {
  test('buildArgs returns correct command and flags', async () => {
    const { buildArgs } = await import('../src/claude.js');
    const args = buildArgs('claude');
    assert.equal(args.cmd, 'claude');
    assert.deepEqual(args.flags, ['-p', '--output-format', 'json', '--no-session-persistence']);
  });

  test('buildArgs uses custom path', async () => {
    const { buildArgs } = await import('../src/claude.js');
    const args = buildArgs('/usr/local/bin/claude');
    assert.equal(args.cmd, '/usr/local/bin/claude');
    assert.ok(args.flags.includes('-p'));
  });

  test('parseClaudeOutput extracts result from JSON envelope', async () => {
    const { parseClaudeOutput } = await import('../src/claude.js');
    const envelope = JSON.stringify({
      type: 'result',
      result: 'Hello world',
      is_error: false,
    });
    const result = parseClaudeOutput(envelope);
    assert.equal(result, 'Hello world');
  });

  test('parseClaudeOutput throws on error response', async () => {
    const { parseClaudeOutput } = await import('../src/claude.js');
    const envelope = JSON.stringify({
      type: 'result',
      result: 'Something went wrong',
      is_error: true,
    });
    assert.throws(() => parseClaudeOutput(envelope), /Claude CLI error: Something went wrong/);
  });

  test('parseClaudeOutput handles plain text (non-JSON) output', async () => {
    const { parseClaudeOutput } = await import('../src/claude.js');
    const result = parseClaudeOutput('Just plain text');
    assert.equal(result, 'Just plain text');
  });

  test('parseClaudeOutput returns stdout when result is undefined', async () => {
    const { parseClaudeOutput } = await import('../src/claude.js');
    const envelope = JSON.stringify({ type: 'result', is_error: false });
    // result is undefined, so parsed.result ?? stdout returns stdout
    const result = parseClaudeOutput(envelope);
    assert.equal(result, envelope);
  });

  test('parseClaudeOutput returns result when result is empty string', async () => {
    const { parseClaudeOutput } = await import('../src/claude.js');
    const envelope = JSON.stringify({ type: 'result', result: '', is_error: false });
    const result = parseClaudeOutput(envelope);
    // '' ?? stdout => '' (empty string is not nullish)
    assert.equal(result, '');
  });

  test('parseClaudeOutput returns result with complex JSON content', async () => {
    const { parseClaudeOutput } = await import('../src/claude.js');
    const innerData = JSON.stringify({ topics: ['a', 'b'], count: 3 });
    const envelope = JSON.stringify({ type: 'result', result: innerData, is_error: false });
    const result = parseClaudeOutput(envelope);
    assert.equal(result, innerData);
  });
});
