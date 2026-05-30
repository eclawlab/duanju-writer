import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveArtifact, loadArtifact, removeArtifact } from '../src/artifacts.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'art-')); }

test('saveArtifact tags objects with schemaVersion and round-trips', () => {
  const d = tmp();
  try {
    const p = join(d, 'a.json');
    saveArtifact(p, { foo: 1 }, 3);
    const loaded = loadArtifact(p, 3);
    assert.deepEqual(loaded, { foo: 1, schemaVersion: 3 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('saveArtifact refreshes a stale schemaVersion on re-save', () => {
  const d = tmp();
  try {
    const p = join(d, 'a.json');
    saveArtifact(p, { foo: 1, schemaVersion: 1 }, 3);
    assert.equal(loadArtifact(p, 3).schemaVersion, 3);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('arrays and primitives pass through untouched (no tag)', () => {
  const d = tmp();
  try {
    const p = join(d, 'arr.json');
    saveArtifact(p, [1, 2, 3], 3);
    assert.deepEqual(loadArtifact(p, 3), [1, 2, 3]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('loadArtifact returns null + logs on version mismatch', () => {
  const d = tmp();
  try {
    const p = join(d, 'a.json');
    saveArtifact(p, { foo: 1 }, 2);
    const logs = [];
    assert.equal(loadArtifact(p, 3, { log: (m) => logs.push(m) }), null);
    assert.ok(logs.some((l) => /schemaVersion=2 \(expected 3\)/.test(l)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('loadArtifact returns null + logs on corrupt JSON', () => {
  const d = tmp();
  try {
    const p = join(d, 'bad.json');
    writeFileSync(p, '{ not json');
    const logs = [];
    assert.equal(loadArtifact(p, 3, { log: (m) => logs.push(m) }), null);
    assert.ok(logs.some((l) => /corrupt/.test(l)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('loadArtifact returns null silently on missing file', () => {
  const d = tmp();
  try {
    assert.equal(loadArtifact(join(d, 'nope.json'), 3), null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('removeArtifact deletes when present, false when absent', () => {
  const d = tmp();
  try {
    const p = join(d, 'a.json');
    saveArtifact(p, { x: 1 }, 1);
    assert.equal(removeArtifact(p), true);
    assert.equal(existsSync(p), false);
    assert.equal(removeArtifact(p), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
