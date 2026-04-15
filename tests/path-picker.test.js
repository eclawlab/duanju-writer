import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findAllPaths, linearizeOutline } from '../src/path-picker.js';

// Sample branching outline for tests
function makeOutline() {
  return {
    title: 'Test Story',
    synopsis: 'A test branching story',
    genres: ['test'],
    tags: [],
    characterQuestions: [],
    episodes: [
      {
        episodeIndex: 0, title: 'Start', isEnding: false,
        scenePlan: [{ summary: 'Opening' }, { summary: 'Decision' }],
        episodeChoices: [
          { text: 'Go left', nextEpisodeIndex: 1 },
          { text: 'Go right', nextEpisodeIndex: 2 },
          { text: 'Stay', nextEpisodeIndex: 3 },
        ],
      },
      {
        episodeIndex: 1, title: 'Left Path', isEnding: false,
        scenePlan: [{ summary: 'Forest' }],
        episodeChoices: [
          { text: 'Fight', nextEpisodeIndex: 4 },
          { text: 'Flee', nextEpisodeIndex: 5 },
          { text: 'Negotiate', nextEpisodeIndex: 6 },
        ],
      },
      {
        episodeIndex: 2, title: 'Right Path', isEnding: true, ending: 'BAD',
        scenePlan: [{ summary: 'Trap' }],
        episodeChoices: [],
      },
      {
        episodeIndex: 3, title: 'Stay Ending', isEnding: true, ending: 'NEUTRAL',
        scenePlan: [{ summary: 'Wait' }],
        episodeChoices: [],
      },
      {
        episodeIndex: 4, title: 'Victory', isEnding: true, ending: 'GOOD',
        scenePlan: [{ summary: 'Win' }],
        episodeChoices: [],
      },
      {
        episodeIndex: 5, title: 'Escape', isEnding: true, ending: 'NEUTRAL',
        scenePlan: [{ summary: 'Run' }],
        episodeChoices: [],
      },
      {
        episodeIndex: 6, title: 'Peace', isEnding: true, ending: 'GOOD',
        scenePlan: [{ summary: 'Talk' }],
        episodeChoices: [],
      },
    ],
  };
}

describe('path-picker', () => {
  describe('findAllPaths', () => {
    test('finds all root-to-ending paths', () => {
      const outline = makeOutline();
      const paths = findAllPaths(outline);
      assert.equal(paths.length, 5);
    });

    test('all paths start at episode 0', () => {
      const outline = makeOutline();
      const paths = findAllPaths(outline);
      for (const path of paths) {
        assert.equal(path[0], 0);
      }
    });

    test('all paths end at an ending episode', () => {
      const outline = makeOutline();
      const paths = findAllPaths(outline);
      const endingIndices = new Set(
        outline.episodes.filter(e => e.isEnding).map(e => e.episodeIndex)
      );
      for (const path of paths) {
        assert.ok(endingIndices.has(path[path.length - 1]),
          `Path ends at ${path[path.length - 1]} which is not an ending`);
      }
    });

    test('includes direct ending paths (short paths)', () => {
      const outline = makeOutline();
      const paths = findAllPaths(outline);
      // Episode 0 -> 2 (BAD ending) and 0 -> 3 (NEUTRAL ending) are 2-step paths
      const shortPaths = paths.filter(p => p.length === 2);
      assert.equal(shortPaths.length, 2);
    });

    test('includes longer paths through branches', () => {
      const outline = makeOutline();
      const paths = findAllPaths(outline);
      // Episode 0 -> 1 -> 4/5/6 are 3-step paths
      const longPaths = paths.filter(p => p.length === 3);
      assert.equal(longPaths.length, 3);
    });

    test('handles single-episode story', () => {
      const outline = {
        episodes: [{
          episodeIndex: 0, title: 'Only', isEnding: true, ending: 'GOOD',
          scenePlan: [{ summary: 'Everything' }],
          episodeChoices: [],
        }],
      };
      const paths = findAllPaths(outline);
      assert.equal(paths.length, 1);
      assert.deepEqual(paths[0], [0]);
    });

    test('handles converging paths (shared episodes)', () => {
      const outline = {
        episodes: [
          {
            episodeIndex: 0, title: 'Start', isEnding: false,
            scenePlan: [{ summary: 's' }],
            episodeChoices: [
              { text: 'A', nextEpisodeIndex: 1 },
              { text: 'B', nextEpisodeIndex: 2 },
              { text: 'C', nextEpisodeIndex: 3 },
            ],
          },
          {
            episodeIndex: 1, title: 'Path A', isEnding: false,
            scenePlan: [{ summary: 's' }],
            episodeChoices: [
              { text: 'Merge', nextEpisodeIndex: 3 },
              { text: 'End', nextEpisodeIndex: 4 },
              { text: 'Also', nextEpisodeIndex: 5 },
            ],
          },
          {
            episodeIndex: 2, title: 'Path B', isEnding: false,
            scenePlan: [{ summary: 's' }],
            episodeChoices: [
              { text: 'Merge', nextEpisodeIndex: 3 },
              { text: 'Alt', nextEpisodeIndex: 4 },
              { text: 'Also', nextEpisodeIndex: 5 },
            ],
          },
          {
            episodeIndex: 3, title: 'Shared End', isEnding: true, ending: 'GOOD',
            scenePlan: [{ summary: 's' }], episodeChoices: [],
          },
          {
            episodeIndex: 4, title: 'Alt End', isEnding: true, ending: 'BAD',
            scenePlan: [{ summary: 's' }], episodeChoices: [],
          },
          {
            episodeIndex: 5, title: 'Also End', isEnding: true, ending: 'NEUTRAL',
            scenePlan: [{ summary: 's' }], episodeChoices: [],
          },
        ],
      };
      const paths = findAllPaths(outline);
      // 0->1->3, 0->1->4, 0->1->5, 0->2->3, 0->2->4, 0->2->5, 0->3
      assert.equal(paths.length, 7);
    });

    test('does not loop on cycles', () => {
      // Shouldn't happen in practice (outline validation prevents it),
      // but guard against infinite loops
      const outline = {
        episodes: [
          {
            episodeIndex: 0, title: 'Start', isEnding: false,
            scenePlan: [{ summary: 's' }],
            episodeChoices: [
              { text: 'Loop', nextEpisodeIndex: 1 },
              { text: 'End', nextEpisodeIndex: 2 },
              { text: 'Also', nextEpisodeIndex: 2 },
            ],
          },
          {
            episodeIndex: 1, title: 'Mid', isEnding: false,
            scenePlan: [{ summary: 's' }],
            episodeChoices: [
              { text: 'Back', nextEpisodeIndex: 0 },
              { text: 'End', nextEpisodeIndex: 2 },
              { text: 'Also', nextEpisodeIndex: 2 },
            ],
          },
          {
            episodeIndex: 2, title: 'End', isEnding: true, ending: 'GOOD',
            scenePlan: [{ summary: 's' }], episodeChoices: [],
          },
        ],
      };
      const paths = findAllPaths(outline);
      // Should find paths to ending (episode 2) without infinite looping
      // The cycle guard prevents 0->1->0->... from recurring
      assert.ok(paths.length >= 2, `Expected at least 2 paths, got ${paths.length}`);
      // All paths must end at the ending episode
      for (const path of paths) {
        assert.equal(path[path.length - 1], 2);
      }
    });
  });

  describe('linearizeOutline', () => {
    test('creates linear episode sequence', () => {
      const outline = makeOutline();
      const path = [0, 1, 4]; // Start -> Left -> Victory
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.episodes.length, 3);
    });

    test('re-indexes episodes from 0', () => {
      const outline = makeOutline();
      const path = [0, 1, 4]; // Original indices: 0, 1, 4
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.episodes[0].episodeIndex, 0);
      assert.equal(linear.episodes[1].episodeIndex, 1);
      assert.equal(linear.episodes[2].episodeIndex, 2);
    });

    test('preserves episode titles', () => {
      const outline = makeOutline();
      const path = [0, 1, 4];
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.episodes[0].title, 'Start');
      assert.equal(linear.episodes[1].title, 'Left Path');
      assert.equal(linear.episodes[2].title, 'Victory');
    });

    test('removes episodeChoices', () => {
      const outline = makeOutline();
      const path = [0, 1, 4];
      const linear = linearizeOutline(outline, path);
      for (const ep of linear.episodes) {
        assert.deepEqual(ep.episodeChoices, []);
      }
    });

    test('preserves scene plans', () => {
      const outline = makeOutline();
      const path = [0, 1, 4];
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.episodes[0].scenePlan.length, 2);
      assert.equal(linear.episodes[1].scenePlan.length, 1);
      assert.equal(linear.episodes[2].scenePlan.length, 1);
    });

    test('preserves story-level metadata', () => {
      const outline = makeOutline();
      const path = [0, 2];
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.title, 'Test Story');
      assert.equal(linear.synopsis, 'A test branching story');
      assert.deepEqual(linear.genres, ['test']);
    });

    test('preserves isEnding and ending on last episode', () => {
      const outline = makeOutline();
      const path = [0, 1, 4]; // Victory = GOOD ending
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.episodes[2].isEnding, true);
      assert.equal(linear.episodes[2].ending, 'GOOD');
    });

    test('throws on invalid episode index in path', () => {
      const outline = makeOutline();
      assert.throws(
        () => linearizeOutline(outline, [0, 99]),
        /Episode 99 not found/
      );
    });

    test('handles short path (2 episodes)', () => {
      const outline = makeOutline();
      const path = [0, 2]; // Start -> Right Path (BAD ending)
      const linear = linearizeOutline(outline, path);
      assert.equal(linear.episodes.length, 2);
      assert.equal(linear.episodes[1].ending, 'BAD');
    });
  });
});
