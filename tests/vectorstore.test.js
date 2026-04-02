import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '.test_vectorstore');

describe('vectorstore', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('tokenize splits text into lowercase tokens', async () => {
    const { tokenize } = await import('../src/vectorstore.js');
    const tokens = tokenize('Hello World Foo Bar');
    assert.deepEqual(tokens, ['hello', 'world', 'foo', 'bar']);
  });

  test('tokenize strips punctuation and filters stopwords', async () => {
    const { tokenize } = await import('../src/vectorstore.js');
    const tokens = tokenize('The quick, brown fox! Is running.');
    // 'the' and 'is' are stopwords; punctuation stripped
    assert.ok(!tokens.includes('the'), 'should filter "the"');
    assert.ok(!tokens.includes('is'), 'should filter "is"');
    assert.ok(tokens.includes('quick'), 'should include "quick"');
    assert.ok(tokens.includes('brown'), 'should include "brown"');
    assert.ok(tokens.includes('fox'), 'should include "fox"');
    assert.ok(tokens.includes('running'), 'should include "running"');
  });

  test('cosineSimilarity returns 1 for identical vectors', async () => {
    const { cosineSimilarity } = await import('../src/vectorstore.js');
    const v = [1, 2, 3];
    assert.equal(cosineSimilarity(v, v), 1);
  });

  test('cosineSimilarity returns 0 for orthogonal vectors', async () => {
    const { cosineSimilarity } = await import('../src/vectorstore.js');
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    assert.equal(cosineSimilarity(a, b), 0);
  });

  test('cosineSimilarity returns 0 for zero vectors', async () => {
    const { cosineSimilarity } = await import('../src/vectorstore.js');
    assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
    assert.equal(cosineSimilarity([0, 0, 0], [0, 0, 0]), 0);
  });

  test('createStore add and search finds relevant results', async () => {
    const { createStore } = await import('../src/vectorstore.js');
    const storePath = join(TEST_DIR, 'store.json');
    const store = createStore(storePath);

    store.add('doc1', 'machine learning neural networks deep learning', { category: 'ml' });
    store.add('doc2', 'baking bread flour yeast oven recipes', { category: 'cooking' });
    store.add('doc3', 'python programming language code functions', { category: 'programming' });

    const results = store.search('neural network machine learning algorithms', 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'doc1');
    assert.ok(results[0].score > 0, 'score should be positive');
    assert.equal(results[0].metadata.category, 'ml');
    assert.ok(typeof results[0].text === 'string');
  });

  test('createStore search returns top-k sorted by score', async () => {
    const { createStore } = await import('../src/vectorstore.js');
    const storePath = join(TEST_DIR, 'store2.json');
    const store = createStore(storePath);

    store.add('a', 'cat feline kitten meow purr whiskers', {});
    store.add('b', 'dog canine puppy bark woof fetch', {});
    store.add('c', 'bird feathers wings fly chirp', {});
    store.add('d', 'cat kitten feline meow', {});

    const results = store.search('cat feline kitten', 3);
    assert.equal(results.length, 3);
    // results should be sorted descending by score
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(results[i].score >= results[i + 1].score, 'results should be sorted by score descending');
    }
    // top result should be about cats
    assert.ok(results[0].id === 'a' || results[0].id === 'd', 'top result should be cat-related');
  });

  test('createStore save and load persists data', async () => {
    const { createStore } = await import('../src/vectorstore.js');
    const storePath = join(TEST_DIR, 'persist.json');

    const store1 = createStore(storePath);
    store1.add('x', 'hello world test data', { tag: 'test' });
    store1.add('y', 'another document here', { tag: 'other' });
    await store1.save();

    assert.ok(existsSync(storePath), 'file should exist after save');

    const store2 = createStore(storePath);
    await store2.load();
    assert.equal(store2.size(), 2);

    const results = store2.search('hello world', 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'x');
    assert.equal(results[0].metadata.tag, 'test');
  });

  test('createStore clear empties the store', async () => {
    const { createStore } = await import('../src/vectorstore.js');
    const storePath = join(TEST_DIR, 'clear.json');
    const store = createStore(storePath);

    store.add('p', 'some content here', {});
    store.add('q', 'more content there', {});
    assert.equal(store.size(), 2);

    await store.save();
    assert.ok(existsSync(storePath), 'file should exist after save');

    await store.clear();
    assert.equal(store.size(), 0);
    assert.ok(!existsSync(storePath), 'file should be deleted after clear');
  });

  test('createStore remove deletes entry', async () => {
    const { createStore } = await import('../src/vectorstore.js');
    const storePath = join(TEST_DIR, 'remove.json');
    const store = createStore(storePath);

    store.add('m', 'machine learning content', { type: 'ml' });
    store.add('n', 'natural language processing', { type: 'nlp' });
    assert.equal(store.size(), 2);

    store.remove('m');
    assert.equal(store.size(), 1);

    // search should not return removed entry
    const results = store.search('machine learning', 5);
    const ids = results.map(r => r.id);
    assert.ok(!ids.includes('m'), 'removed entry should not appear in results');
  });
});
