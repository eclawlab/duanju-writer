// Small async concurrency helper.

/**
 * Run `fn` over `items` with at most `limit` concurrent executions, preserving
 * input order in the returned results array. Rejects on the first error a task
 * throws — callers that need per-item resilience should catch inside `fn` and
 * return a sentinel instead.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit - max concurrent executions (clamped to [1, items.length])
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  // Once any task rejects, Promise.all rejects — but the sibling worker loops
  // are coroutines it cannot cancel, so without this shared flag they keep
  // pulling and invoking fn on the remaining items in the background (extra
  // side-effecting LLM/network/file calls after the caller already gave up).
  let failed = false;
  const run = async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
