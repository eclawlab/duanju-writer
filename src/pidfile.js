import {
  existsSync, readFileSync, writeFileSync, renameSync,
  openSync, closeSync, unlinkSync, statSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PIDFILE } from './constants.js';

const LOCK_STALE_MS = 30_000;
const LOCK_MAX_ATTEMPTS = 100;
const LOCK_SLEEP_MS = 20;
const DEFAULT_GRACE_MS = 2000;

function emptyState() { return { parent: null, children: [] }; }

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function withLock(filePath, fn) {
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
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {}
      sleepSync(LOCK_SLEEP_MS);
      continue;
    }
    try { return fn(); }
    finally {
      try { closeSync(fd); } catch {}
      try { unlinkSync(lockPath); } catch {}
    }
  }
  throw new Error(`Could not acquire lock on ${filePath}`);
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  const parent = Number.isInteger(raw.parent) ? raw.parent : null;
  const children = Array.isArray(raw.children)
    ? raw.children.filter(n => Number.isInteger(n))
    : [];
  return { parent, children };
}

function readState(filePath) {
  if (!existsSync(filePath)) return emptyState();
  try {
    return normalizeState(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return emptyState();
  }
}

function writeState(filePath, state) {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(2).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

// ─── Default signature checks ────────────────────────────────────────────────

function defaultIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function defaultCommandFor(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

// role is 'parent' (daemon) or 'child' (claude CLI)
function defaultMatchesSignature(cmd, role) {
  if (!cmd) return false;
  if (role === 'parent') return cmd.includes('duanju-copier');
  if (role === 'child') {
    // The writer always invokes the Claude CLI with `--no-session-persistence`
    // (see llm.js createClaudeCliAdapter). A bare `cmd.includes('claude')` was
    // dangerously loose: after PID reuse it would happily match Claude Code,
    // claude-bench, or anything with "claude" in the path, and cleanupStaleIn
    // would SIGKILL it. Requiring the unique flag distinguishes our spawned
    // children from any other claude-named process the user is running.
    return cmd.includes('claude') && cmd.includes('--no-session-persistence');
  }
  return false;
}

function defaultSendSignal(pid, signal) {
  try { process.kill(pid, signal); } catch {}
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function readPidfileFrom(filePath) {
  return readState(filePath);
}

/**
 * Check whether a worker daemon (parent process) is alive based on the
 * pidfile. Verifies both that the recorded PID is responsive AND that its
 * command line still matches the duanju-copier signature, to defend against
 * PID reuse. Returns false when no parent is recorded, or when the recorded
 * PID is dead/reused.
 *
 * Used by `runOnce` to distinguish "another worker holds this job" (don't
 * touch) from "previous worker SIGKILLed and orphaned this job" (recover).
 */
export function isWorkerAliveFrom(filePath, options = {}) {
  const isAlive = options.isAlive || defaultIsAlive;
  const commandFor = options.commandFor || defaultCommandFor;
  const matchesSignature = options.matchesSignature || defaultMatchesSignature;
  const state = readState(filePath);
  if (state.parent === null || state.parent === process.pid) return false;
  if (!isAlive(state.parent)) return false;
  const cmd = commandFor(state.parent);
  return matchesSignature(cmd, 'parent');
}

export function registerParentIn(filePath, pid) {
  return withLock(filePath, () => {
    const state = readState(filePath);
    state.parent = pid;
    writeState(filePath, state);
    return state;
  });
}

export function unregisterParentIn(filePath, pid) {
  return withLock(filePath, () => {
    const state = readState(filePath);
    if (state.parent === pid) state.parent = null;
    writeState(filePath, state);
    return state;
  });
}

export function registerChildIn(filePath, pid) {
  return withLock(filePath, () => {
    const state = readState(filePath);
    if (!state.children.includes(pid)) state.children.push(pid);
    writeState(filePath, state);
    return state;
  });
}

export function unregisterChildIn(filePath, pid) {
  return withLock(filePath, () => {
    const state = readState(filePath);
    state.children = state.children.filter(p => p !== pid);
    writeState(filePath, state);
    return state;
  });
}

/**
 * Read the pidfile, kill any lingering PIDs whose process signature still
 * matches what we expect (parent=duanju-copier, child=claude), then clear
 * the pidfile. Safe against PID reuse because we verify the command string
 * before sending any signal.
 *
 * Options (mainly for tests): isAlive, commandFor, matchesSignature,
 * sendSignal, graceMs.
 *
 * Returns { killed: pid[], skipped: pid[] }.
 */
export function cleanupStaleIn(filePath, options = {}) {
  const isAlive = options.isAlive || defaultIsAlive;
  const commandFor = options.commandFor || defaultCommandFor;
  const matchesSignature = options.matchesSignature || defaultMatchesSignature;
  const sendSignal = options.sendSignal || defaultSendSignal;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;

  return withLock(filePath, () => {
    const state = readState(filePath);
    const entries = [];
    if (state.parent !== null && state.parent !== process.pid) {
      entries.push({ pid: state.parent, role: 'parent' });
    }
    for (const pid of state.children) {
      if (pid !== process.pid) entries.push({ pid, role: 'child' });
    }

    const toKill = [];
    const skipped = [];
    for (const { pid, role } of entries) {
      if (!isAlive(pid)) continue;
      const cmd = commandFor(pid);
      if (!matchesSignature(cmd, role)) {
        skipped.push(pid);
        continue;
      }
      toKill.push(pid);
    }

    for (const pid of toKill) sendSignal(pid, 'SIGTERM');
    if (toKill.length > 0 && graceMs > 0) sleepSync(graceMs);
    const survivors = toKill.filter(pid => isAlive(pid));
    for (const pid of survivors) sendSignal(pid, 'SIGKILL');

    writeState(filePath, emptyState());
    return { killed: toKill, skipped };
  });
}

// ─── Module-level wrappers using the default PIDFILE path ────────────────────

export function readPidfile() { return readPidfileFrom(PIDFILE); }
export function isWorkerAlive(options) { return isWorkerAliveFrom(PIDFILE, options); }
export function registerParent(pid) { return registerParentIn(PIDFILE, pid); }
export function unregisterParent(pid) { return unregisterParentIn(PIDFILE, pid); }
export function registerChild(pid) { return registerChildIn(PIDFILE, pid); }
export function unregisterChild(pid) { return unregisterChildIn(PIDFILE, pid); }
export function cleanupStale(options) { return cleanupStaleIn(PIDFILE, options); }
