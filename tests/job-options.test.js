import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickJobOptions, JOB_OPTION_KEYS } from '../src/job-options.js';

test('pickJobOptions copies known scalar keys, falsy → undefined', () => {
  const r = pickJobOptions({ lang: 'cn', genre: '', episodesPerDrama: 20, mode: 'selftell' });
  assert.equal(r.lang, 'cn');
  assert.equal(r.episodesPerDrama, 20);
  assert.equal(r.mode, 'selftell');
  assert.equal(r.genre, undefined, "empty string → undefined");
  assert.equal(r.style, undefined, "absent → undefined");
});

test('pickJobOptions preserves publish:false (boolean-safe), defaults others to undefined', () => {
  assert.equal(pickJobOptions({ publish: false }).publish, false);
  assert.equal(pickJobOptions({ publish: true }).publish, undefined, "true normalizes to undefined (= default publish)");
  assert.equal(pickJobOptions({}).publish, undefined);
});

test('pickJobOptions does not include reference fields', () => {
  const r = pickJobOptions({ referenceCharacter: 'x', referenceStory: 'y' });
  assert.equal('referenceCharacter' in r, false);
  assert.equal('referenceStory' in r, false);
});

test('JOB_OPTION_KEYS excludes reference + publish (handled separately)', () => {
  for (const k of ['referenceCharacter', 'referenceEvent', 'referenceStory', 'publish']) {
    assert.equal(JOB_OPTION_KEYS.includes(k), false, `${k} must not be in JOB_OPTION_KEYS`);
  }
});
