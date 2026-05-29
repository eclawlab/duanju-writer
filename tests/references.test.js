import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceBlock } from '../src/references.js';

test('character/required block matches the legacy outline shape', () => {
  const block = buildReferenceBlock({
    kind: 'character', lang: 'cn', content: '林昭',
    instruction: '本故事必须包含以下预先定义的角色。',
  });
  assert.equal(block, '\n\n## 参考角色（必须使用）\n\n本故事必须包含以下预先定义的角色。\n\n---\n林昭\n---\n');
});

test('English headings use the REQUIRED label', () => {
  const block = buildReferenceBlock({ kind: 'character', lang: 'en', content: 'Lin', instruction: 'X.' });
  assert.ok(block.includes('## Reference Character (REQUIRED)'));
  assert.ok(block.includes('---\nLin\n---'));
});

test('event/continue and character/preserve variants (tail-outline)', () => {
  const ev = buildReferenceBlock({ kind: 'event', lang: 'cn', variant: 'continue', content: 'E', instruction: 'i' });
  assert.ok(ev.includes('## 参考事件（必须延续）'));
  const ch = buildReferenceBlock({ kind: 'character', lang: 'en', variant: 'preserve', content: 'C', instruction: 'i' });
  assert.ok(ch.includes('## Reference Character (PRESERVE)'));
});

test('unknown kind/variant throws', () => {
  assert.throws(() => buildReferenceBlock({ kind: 'nope', content: '', instruction: '' }), /unknown kind\/variant/);
  assert.throws(() => buildReferenceBlock({ kind: 'event', variant: 'preserve', content: '', instruction: '' }), /unknown kind\/variant/);
});
