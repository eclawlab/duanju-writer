import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('consistency', () => {
  describe('hook density check', () => {
    test('detects clip missing hook on non-conclusion', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const episode = {
        episodeIndex: 0,
        isEnding: false,
        clips: [
          { clipIndex: 0, hook: '来电响起', isConclusion: false },
          { clipIndex: 1, hook: '', isConclusion: false },
        ],
      };
      const issues = checkHookDensity(episode);
      assert.equal(issues.length, 1);
      assert.match(issues[0], /clip 1.*missing hook/);
    });

    test('allows empty hook on conclusion clip', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const episode = {
        episodeIndex: 0,
        isEnding: true,
        clips: [
          { clipIndex: 0, hook: '反派出现', isConclusion: false },
          { clipIndex: 1, hook: '', isConclusion: true },
        ],
      };
      assert.deepEqual(checkHookDensity(episode), []);
    });

    test('handles episode with no clips', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      assert.deepEqual(checkHookDensity({ episodeIndex: 0, clips: [] }), []);
      assert.deepEqual(checkHookDensity({ episodeIndex: 0 }), []);
    });

    test('flags whitespace-only hook as missing', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const issues = checkHookDensity({
        episodeIndex: 2,
        clips: [{ clipIndex: 0, hook: '   ', isConclusion: false }],
      });
      assert.equal(issues.length, 1);
      assert.match(issues[0], /clip 0 of episode 2 missing hook/);
    });
  });
});
