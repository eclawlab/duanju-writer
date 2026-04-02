import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('worker', () => {
  test('getStatusTransitions returns correct pipeline stages', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    assert.deepEqual(transitions, [
      { from: 'pending', to: 'collecting' },
      { from: 'collecting', to: 'writing' },
      { from: 'writing', to: 'uploading' },
      { from: 'uploading', to: 'done' },
    ]);
  });

  test('getStatusTransitions has 4 stages', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    assert.equal(transitions.length, 4);
  });

  test('getStatusTransitions starts from pending', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    assert.equal(transitions[0].from, 'pending');
  });

  test('getStatusTransitions ends at done', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    assert.equal(transitions[transitions.length - 1].to, 'done');
  });

  test('getStatusTransitions forms a connected chain', async () => {
    const { getStatusTransitions } = await import('../src/worker.js');
    const transitions = getStatusTransitions();
    for (let i = 1; i < transitions.length; i++) {
      assert.equal(transitions[i].from, transitions[i - 1].to,
        `Transition ${i} should start where ${i - 1} ended`);
    }
  });
});
