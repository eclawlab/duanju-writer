import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression tests for round-2 codebase-review findings.

// ── HIGH: drama-writer.js calls generateSnowflake (898) and generatePlan (936)
//    but never imported them — both threw ReferenceError, swallowed by the
//    surrounding try/catch, so generateDrama's own snowflake/plan recovery
//    silently degraded. Same class as the worker.js missing-import bug.
describe('round2 — drama-writer imports its snowflake/plan generators', () => {
  const src = readFileSync(new URL('../src/drama-writer.js', import.meta.url), 'utf8');

  test('drama-writer.js imports generateSnowflake from ./snowflake.js', () => {
    assert.match(src, /generateSnowflake\s*\(/, 'generateSnowflake is called');
    assert.match(
      src,
      /import\s*\{[^}]*\bgenerateSnowflake\b[^}]*\}\s*from\s*['"]\.\/snowflake\.js['"]/,
      'generateSnowflake must be imported from ./snowflake.js',
    );
  });

  test('drama-writer.js imports generatePlan from ./planner.js', () => {
    assert.match(src, /generatePlan\s*\(/, 'generatePlan is called');
    assert.match(
      src,
      /import\s*\{[^}]*\bgeneratePlan\b[^}]*\}\s*from\s*['"]\.\/planner\.js['"]/,
      'generatePlan must be imported from ./planner.js',
    );
  });

  test('the depended-on symbols actually exist as exports', async () => {
    const snow = await import('../src/snowflake.js');
    const planner = await import('../src/planner.js');
    assert.equal(typeof snow.generateSnowflake, 'function');
    assert.equal(typeof planner.generatePlan, 'function');
  });
});

// ── HIGH: parseDuckDuckGoResults aligned snippets to titles by a global ordinal
//    that also advanced for skipped empty-title anchors, shifting every later
//    snippet by one. A title with no snippet must not steal the next result's.
describe('round2 — DuckDuckGo result parsing aligns snippets per result', () => {
  test('a skipped empty-title anchor does not shift later snippets', async () => {
    const { parseDuckDuckGoResults } = await import('../src/websearch.js');
    const html = [
      // empty-title anchor (e.g. an image/sponsored link) with NO snippet
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fad.example"></a>',
      // real result B
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example">Title B</a>',
      '<a class="result__snippet" href="#">snippet B</a>',
      // real result C
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fc.example">Title C</a>',
      '<a class="result__snippet" href="#">snippet C</a>',
    ].join('\n');

    const rows = parseDuckDuckGoResults(html, 10);
    const b = rows.find(r => r.title === 'Title B');
    const c = rows.find(r => r.title === 'Title C');
    assert.ok(b && c, 'both real results parsed');
    assert.equal(b.snippet, 'snippet B', 'Title B must keep its own snippet, not C\'s');
    assert.equal(c.snippet, 'snippet C', 'Title C must keep its own snippet');
  });

  test('a real result with no snippet does not steal the next result\'s snippet', async () => {
    const { parseDuckDuckGoResults } = await import('../src/websearch.js');
    const html = [
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example">Title A</a>',
      // A has no snippet
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example">Title B</a>',
      '<a class="result__snippet" href="#">snippet B</a>',
    ].join('\n');

    const rows = parseDuckDuckGoResults(html, 10);
    const a = rows.find(r => r.title === 'Title A');
    const b = rows.find(r => r.title === 'Title B');
    assert.ok(a && b, 'both results parsed');
    assert.equal(a.snippet, undefined, 'Title A has no snippet of its own');
    assert.equal(b.snippet, 'snippet B', 'Title B keeps its snippet');
  });
});

// ── MEDIUM: withLock released the lock by path unconditionally. After a
//    stale-takeover, the original holder's finally could delete the NEW
//    holder's fresh lock. Releasing must only remove a lock we still own.
describe('round2 — withLock does not delete a lock it no longer owns', () => {
  test('releasing after the lock file was replaced does not unlink the replacement', async () => {
    const { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { withLock } = await import('../src/lock.js');

    const dir = mkdtempSync(join(tmpdir(), 'lockown-'));
    try {
      const target = join(dir, 'data.json');
      const lockPath = target + '.lock';

      // Simulate the race: while "our" fn runs, another process takes over and
      // creates its OWN fresh lock at the same path (different file/inode).
      withLock(target, () => {
        rmSync(lockPath, { force: true });           // our original lock removed (takeover)
        writeFileSync(lockPath, 'other-process');     // B's fresh lock now lives here
      });

      // Our finally must NOT have deleted B's fresh lock.
      assert.ok(existsSync(lockPath), 'a fresh lock created by another owner must survive our release');
      assert.equal(readFileSync(lockPath, 'utf8'), 'other-process');
      rmSync(lockPath, { force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('normal release still removes our own lock', async () => {
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { withLock } = await import('../src/lock.js');

    const dir = mkdtempSync(join(tmpdir(), 'lockown2-'));
    try {
      const target = join(dir, 'data.json');
      let ran = false;
      const out = withLock(target, () => { ran = true; return 42; });
      assert.equal(out, 42);
      assert.ok(ran);
      assert.ok(!existsSync(target + '.lock'), 'our own lock must be released');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── LOW: selectChapterProse inverted for budgetChars <= ~30 (negative
//    halfBudget → returns MORE than the input). Must never exceed the budget.
describe('round2 — selectChapterProse respects small budgets', () => {
  test('output never exceeds a tiny budget', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const chapters = [{ chapterIndex: 1, prose: 'x'.repeat(1000) }];
    for (const budget of [0, 10, 20, 30, 50]) {
      const out = selectChapterProse(chapters, [1, 1], budget);
      assert.ok(out.length <= Math.max(budget, 60),
        `budget ${budget} produced ${out.length} chars (must not balloon past input)`);
      assert.ok(out.length <= 1000, `budget ${budget} produced ${out.length} > input length`);
    }
  });

  test('normal budget still truncates head+tail', async () => {
    const { selectChapterProse } = await import('../src/story-bible.js');
    const chapters = [{ chapterIndex: 1, prose: 'x'.repeat(10000) }];
    const out = selectChapterProse(chapters, [1, 1], 4000);
    assert.ok(out.length <= 4100, 'normal budget truncates');
    assert.match(out, /省略/, 'truncation marker present');
  });
});
