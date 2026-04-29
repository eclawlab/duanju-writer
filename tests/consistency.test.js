import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Test helper: build a scene-shaped object whose top-level fields match
// what parseClip / buildFallbackClip produce — beats are now enumerable on
// the scene itself so the uploader can carry them through to the server.
function makeScene({ clipIndex, hook, isConclusion = false }) {
  return { content: 'x', choices: [], conclusion: null, clipIndex, hook, isConclusion };
}

describe('consistency', () => {
  describe('hook density check', () => {
    test('detects scene missing hook on non-conclusion', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const episode = {
        episodeIndex: 0,
        isEnding: false,
        scenes: [
          makeScene({ clipIndex: 0, hook: '来电响起' }),
          makeScene({ clipIndex: 1, hook: '' }),
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
        scenes: [
          makeScene({ clipIndex: 0, hook: '反派出现' }),
          makeScene({ clipIndex: 1, hook: '', isConclusion: true }),
        ],
      };
      assert.deepEqual(checkHookDensity(episode), []);
    });

    test('handles episode with no scenes', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      assert.deepEqual(checkHookDensity({ episodeIndex: 0, scenes: [] }), []);
      assert.deepEqual(checkHookDensity({ episodeIndex: 0 }), []);
    });

    test('flags whitespace-only hook as missing', async () => {
      const { checkHookDensity } = await import('../src/consistency.js');
      const issues = checkHookDensity({
        episodeIndex: 2,
        scenes: [makeScene({ clipIndex: 0, hook: '   ' })],
      });
      assert.equal(issues.length, 1);
      assert.match(issues[0], /clip 0 of episode 2 missing hook/);
    });
  });
});
