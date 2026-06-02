import { openSync, closeSync, unlinkSync, statSync, fstatSync, renameSync } from 'node:fs';

// Cross-process advisory file lock shared by queue.js / history.js / pidfile.js.
// All three previously carried byte-identical copies of this logic; centralizing
// keeps a single tested implementation of the stale-takeover semantics.

const LOCK_STALE_MS = 30_000;
const LOCK_MAX_ATTEMPTS = 100;
const LOCK_SLEEP_MS = 20;

// Busy-wait sleep that works without async. Uses Atomics.wait on a throwaway
// SharedArrayBuffer so the lock loop (and pidfile's SIGTERM grace period) can
// pause synchronously inside an otherwise-synchronous critical section.
export function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// Acquire `<filePath>.lock` (O_CREAT|O_EXCL), run fn, release. Retries on
// contention; takes over a lock older than LOCK_STALE_MS via an atomic rename
// (rename of a given path succeeds for exactly one racing process; losers get
// ENOENT and retry, so two processes never both "take over" the same stale
// lock, and a fresh lock created at the same path is never deleted).
export function withLock(filePath, fn) {
  const lockPath = filePath + '.lock';
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try {
            const claim = `${lockPath}.stale.${process.pid}.${Date.now()}`;
            renameSync(lockPath, claim);
            unlinkSync(claim);
          } catch {}
          continue;
        }
      } catch {}
      sleepSync(LOCK_SLEEP_MS);
      continue;
    }
    // Record the inode of the lock WE created so release only removes our own
    // lock. If our fn outran LOCK_STALE_MS and another process took over and
    // created a fresh lock at the same path, unlinking by path alone would
    // delete THAT process's live lock — letting a third enter concurrently.
    let ourIno;
    try { ourIno = fstatSync(fd).ino; } catch {}
    try { return fn(); }
    finally {
      try { closeSync(fd); } catch {}
      try {
        // Only unlink if the lock still on disk is the one we created.
        if (ourIno === undefined || statSync(lockPath).ino === ourIno) {
          unlinkSync(lockPath);
        }
      } catch {}
    }
  }
  throw new Error(`Could not acquire lock on ${filePath}`);
}
