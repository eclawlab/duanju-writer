import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createState,
  addCharacter,
  updateCharacter,
  addItem,
  updateItem,
  addLocation,
  updateLocation,
  addRevelation,
  markRevealed,
  getAvailableRevelations,
  getCharacterContext,
  validate,
  serialize,
  deserialize,
  toPromptContext,
} from '../src/story-state.js';

describe('story-state', () => {
  test('createState returns empty collections', () => {
    const state = createState();
    assert.deepEqual(state.characters, {});
    assert.deepEqual(state.items, {});
    assert.deepEqual(state.locations, {});
    assert.deepEqual(state.revelations, []);
  });

  test('addCharacter tracks a character', () => {
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: ['magic'], emotional: 'anxious' });
    assert.ok(state.characters['Alice']);
    assert.equal(state.characters['Alice'].status, 'alive');
    assert.equal(state.characters['Alice'].location, 'forest');
    assert.deepEqual(state.characters['Alice'].knowledge, ['magic']);
    assert.equal(state.characters['Alice'].emotional, 'anxious');
  });

  test('updateCharacter merges fields', () => {
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [], emotional: 'calm' });
    updateCharacter(state, 'Alice', { status: 'dead', emotional: 'none' });
    assert.equal(state.characters['Alice'].status, 'dead');
    assert.equal(state.characters['Alice'].emotional, 'none');
    assert.equal(state.characters['Alice'].location, 'forest'); // unchanged
  });

  test('addItem tracks an item', () => {
    const state = createState();
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });
    assert.ok(state.items['Sword']);
    assert.equal(state.items['Sword'].status, 'active');
    assert.equal(state.items['Sword'].holder, 'Alice');
    assert.equal(state.items['Sword'].location, null);
  });

  test('updateItem changes item state', () => {
    const state = createState();
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });
    updateItem(state, 'Sword', { status: 'destroyed', holder: null });
    assert.equal(state.items['Sword'].status, 'destroyed');
    assert.equal(state.items['Sword'].holder, null);
  });

  test('addLocation tracks a location', () => {
    const state = createState();
    addLocation(state, { name: 'forest', status: 'intact' });
    assert.ok(state.locations['forest']);
    assert.equal(state.locations['forest'].status, 'intact');
  });

  test('addRevelation adds tagged plot info', () => {
    const state = createState();
    addRevelation(state, { id: 'rev1', info: 'The butler did it', visibility: 'hidden', revealInScene: 3 });
    assert.equal(state.revelations.length, 1);
    assert.equal(state.revelations[0].id, 'rev1');
    assert.equal(state.revelations[0].info, 'The butler did it');
    assert.equal(state.revelations[0].visibility, 'hidden');
    assert.equal(state.revelations[0].revealInScene, 3);
    assert.equal(state.revelations[0].revealed, false);
  });

  test('getAvailableRevelations returns only scheduled + public revelations', () => {
    const state = createState();
    addRevelation(state, { id: 'pub1', info: 'Public info', visibility: 'public', revealInScene: 0 });
    addRevelation(state, { id: 'hid1', info: 'Hidden scene 2', visibility: 'hidden', revealInScene: 2 });
    addRevelation(state, { id: 'del1', info: 'Delayed scene 5', visibility: 'delayed', revealInScene: 5 });
    addRevelation(state, { id: 'nev1', info: 'Never explicit', visibility: 'never_explicit', revealInScene: 1 });

    const atScene2 = getAvailableRevelations(state, 2);
    const ids2 = atScene2.map(r => r.id);
    assert.ok(ids2.includes('pub1'), 'public always included');
    assert.ok(ids2.includes('hid1'), 'hidden with revealInScene <= 2 included');
    assert.ok(!ids2.includes('del1'), 'delayed scene 5 not yet available at scene 2');
    assert.ok(!ids2.includes('nev1'), 'never_explicit excluded');

    const atScene5 = getAvailableRevelations(state, 5);
    const ids5 = atScene5.map(r => r.id);
    assert.ok(ids5.includes('del1'), 'delayed available at scene 5');
  });

  test('markRevealed marks revelation', () => {
    const state = createState();
    addRevelation(state, { id: 'rev1', info: 'Secret', visibility: 'hidden', revealInScene: 1 });
    markRevealed(state, 'rev1');
    assert.equal(state.revelations[0].revealed, true);

    // Revealed revelations should not appear in getAvailableRevelations
    const available = getAvailableRevelations(state, 5);
    assert.ok(!available.find(r => r.id === 'rev1'), 'revealed revelation excluded');
  });

  test('getCharacterContext returns only what character knows', () => {
    const state = createState();
    addLocation(state, { name: 'tavern', status: 'intact' });
    addLocation(state, { name: 'dungeon', status: 'intact' });
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'tavern', knowledge: [], emotional: 'calm' });
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });
    addItem(state, { name: 'Gem', status: 'active', holder: null, location: 'dungeon' });

    const ctx = getCharacterContext(state, 'Alice');
    assert.ok(ctx.characters['Alice'], 'character herself included');
    assert.ok(ctx.items['Sword'], 'held item included');
    assert.ok(!ctx.items['Gem'], 'item in different location excluded');
    assert.ok(ctx.locations['tavern'], "character's location included");
    assert.ok(!ctx.locations['dungeon'], 'other location excluded');
  });

  test('getCharacterContext includes co-located characters', () => {
    const state = createState();
    addLocation(state, { name: 'tavern', status: 'intact' });
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'tavern', knowledge: [], emotional: 'calm' });
    addCharacter(state, { name: 'Bob', status: 'alive', location: 'tavern', knowledge: [], emotional: 'happy' });
    addCharacter(state, { name: 'Carol', status: 'alive', location: 'dungeon', knowledge: [], emotional: 'scared' });

    const ctx = getCharacterContext(state, 'Alice');
    assert.ok(ctx.characters['Alice'], 'Alice included');
    assert.ok(ctx.characters['Bob'], 'co-located Bob included');
    assert.ok(!ctx.characters['Carol'], 'Carol at different location excluded');
  });

  test('validate detects dead char holding active item', () => {
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'dead', location: 'forest', knowledge: [], emotional: 'none' });
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });

    const errors = validate(state);
    assert.ok(errors.length > 0, 'should detect contradiction');
    assert.ok(errors.some(e => e.includes('Alice') && e.includes('Sword')), 'error mentions dead char and item');
  });

  test('validate returns empty for clean state', () => {
    const state = createState();
    addLocation(state, { name: 'forest', status: 'intact' });
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [], emotional: 'calm' });
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });

    const errors = validate(state);
    assert.deepEqual(errors, []);
  });

  test('serialize/deserialize round-trip', () => {
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: ['magic'], emotional: 'calm' });
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });
    addLocation(state, { name: 'forest', status: 'intact' });
    addRevelation(state, { id: 'rev1', info: 'Secret', visibility: 'hidden', revealInScene: 2 });

    const json = serialize(state);
    assert.equal(typeof json, 'string');

    const restored = deserialize(json);
    assert.deepEqual(restored, state);
  });

  test('toPromptContext formats state as string', () => {
    const state = createState();
    addCharacter(state, { name: 'Alice', status: 'alive', location: 'forest', knowledge: [], emotional: 'calm' });
    addItem(state, { name: 'Sword', status: 'active', holder: 'Alice', location: null });
    addLocation(state, { name: 'forest', status: 'intact' });

    const text = toPromptContext(state);
    assert.equal(typeof text, 'string');
    assert.ok(text.includes('### Characters'), 'has Characters section');
    assert.ok(text.includes('### Items'), 'has Items section');
    assert.ok(text.includes('### Locations'), 'has Locations section');
    assert.ok(text.includes('Alice'), 'mentions Alice');
    assert.ok(text.includes('Sword'), 'mentions Sword');
    assert.ok(text.includes('forest'), 'mentions forest');
  });
});
