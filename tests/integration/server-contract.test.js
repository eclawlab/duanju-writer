// End-to-end contract test against a live `../duanju` server. Excluded from
// the default `npm test` glob (`tests/*.test.js` is non-recursive). Run with
// `npm run test:integration` and DUANJU_SERVER_URL + DUANJU_API_KEY set.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const SERVER_URL = process.env.DUANJU_SERVER_URL;
const API_KEY    = process.env.DUANJU_API_KEY;

if (!SERVER_URL || !API_KEY) {
  throw new Error(
    'integration test requires DUANJU_SERVER_URL and DUANJU_API_KEY env vars'
  );
}

describe('server contract — end-to-end POST /api/ai/stories', () => {
  test('writer payload is accepted by ../duanju server (returns 201 + story.id)', async () => {
    const { buildRequest } = await import('../../src/uploader.js');

    // Hand-built drama in the post-Task-9 in-memory shape: episodes[].scenes[]
    // with composed content + structured conclusion. Mirrors what parseClip
    // would emit at the end of a real generation run.
    const drama = {
      title: '契约测试 · 战神归来',
      synopsis: '一句钩子，验证服务端契约',
      trope: '战神归来',
      genre: '都市',
      genres: ['复仇'],
      tags: ['打脸'],
      episodes: [
        {
          episodeIndex: 0,
          title: '第1集',
          scenes: [
            {
              content: '[narrator]\n夜雨破庙\n\n[narrator]\n陆衡踉跄推门\n\n[character:陆衡]\n三年了……该回去了\n\n[narrator]\n身后传来摩托声',
              choices: [],
              conclusion: null,
            },
          ],
        },
        {
          episodeIndex: 1,
          title: '终局',
          scenes: [
            {
              content: '[narrator]\n灯熄\n\n[character:陆衡]\n这局我赢',
              choices: [],
              conclusion: { title: '结局', overview: '反派全员跪地', type: 'STORY_END', ending: 'GOOD' },
            },
          ],
        },
      ],
    };

    const config = { autostoryUrl: SERVER_URL, aiApiKey: API_KEY };
    const { url, options } = buildRequest(drama, config, {
      variationGroupId: `contract-test-${Date.now()}`,
      variationLabel: '爽爆',
      idempotencyKey: `contract-test-${Date.now()}`,
    });

    const res = await fetch(url, options);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${text.slice(0, 500)}`);
    assert.ok(body && body.story && body.story.id, `response missing story.id: ${text.slice(0, 500)}`);
    assert.ok(Array.isArray(body.episodes), 'response missing episodes array');
    assert.equal(body.episodes.length, 2, 'expected 2 episodes in response');
    assert.equal(body.episodes[1].scenes[0].hasConclusion, true, 'final scene should have a conclusion');
  });
});
