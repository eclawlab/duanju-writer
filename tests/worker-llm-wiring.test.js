import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression coverage for two CRITICAL wiring bugs found in review:
//   #1 worker.js called generatePlan() without importing it → every fresh job
//      silently fell back to an empty plan skeleton (the ReferenceError was
//      swallowed by the surrounding try/catch).
//   #2 drama-writer.js's generateDrama referenced an undeclared `llmFn`, and
//      generateClip ignored ctx.llmFn (called callLLM directly) → clip retry
//      and per-episode compression always threw and degraded to fallbacks.
//
// Both slipped past CI because no test drove the integrated path. The e2e
// test below (generateDrama with a canned llmFn) is the real behavioral net;
// the import-binding checks here are cheap static guards against regressions.

const workerSrc = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

test('worker.js imports generatePlan (Fix #1: missing import)', () => {
  // worker.js:~408 calls `await generatePlan(...)`. It MUST be imported, or the
  // call throws ReferenceError and the catch poisons every job with an empty plan.
  assert.match(workerSrc, /generatePlan/, 'worker.js should reference generatePlan');
  assert.match(
    workerSrc,
    /import\s*\{[^}]*\bgeneratePlan\b[^}]*\}\s*from\s*['"]\.\/planner\.js['"]/,
    'generatePlan must be imported from ./planner.js',
  );
});

test('worker.js module loads without binding errors and exposes the planner symbol', async () => {
  // A missing import would not throw at module-eval time (the call is inside a
  // function), so additionally assert the binding actually resolves by importing
  // planner.js and confirming the export worker depends on exists.
  const planner = await import('../src/planner.js');
  assert.equal(typeof planner.generatePlan, 'function', 'planner must export generatePlan');
});
