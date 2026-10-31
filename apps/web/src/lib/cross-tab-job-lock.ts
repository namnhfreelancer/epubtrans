import { useSyncExternalStore } from 'react';
import { broadcast, onCrossTabMessage } from './cross-tab-channel';

/**
 * One translation job per project across all tabs of the origin, via the Web Locks API: the tab running
 * a job holds `epubtrans:job:<projectId>` until the job settles (the browser releases it if the tab dies).
 * Other tabs learn about it from `navigator.locks.query()`, re-run on a short interval, on focus and when
 * a tab announces a job start/end over the project's BroadcastChannel.
 * Without `navigator.locks` jobs run unguarded and no project is ever reported as busy elsewhere.
 */
const PREFIX = 'epubtrans:job:';
const POLL_MS = 1000;

export const jobLockName = (projectId: string): string => `${PREFIX}${projectId}`;

function lockManager(): LockManager | undefined {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : undefined;
}

/** Projects whose job lock this tab holds (never reported as "elsewhere"). */
const heldHere = new Set<string>();
let elsewhere: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
/** Only the most recently started query may publish, so a result from before a lock change never wins. */
let generation = 0;
let stopWatching: (() => void) | undefined;

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((v) => b.has(v));

/** Re-reads which job locks are held by other tabs. */
export async function refreshJobLocks(): Promise<void> {
  const locks = lockManager();
  if (!locks) return;
  const mine = ++generation;
  let held: LockInfo[];
  try {
    held = (await locks.query()).held ?? [];
  } catch (err) {
    console.warn('epubtrans: could not query job locks', err);
    return;
  }
  if (mine !== generation) return;
  const next = new Set<string>();
  for (const lock of held) {
    const id = lock.name?.startsWith(PREFIX) ? lock.name.slice(PREFIX.length) : undefined;
    if (id && !heldHere.has(id)) next.add(id);
  }
  if (sameSet(next, elsewhere)) return;
  elsewhere = next;
  for (const l of [...listeners]) l();
}

/**
 * Fresh answer (not the polled snapshot) to "is another tab running a job for this project?", for guarding
 * destructive actions at the moment they are attempted. False without the Web Locks API.
 */
export async function isJobRunningElsewhere(projectId: string): Promise<boolean> {
  const locks = lockManager();
  if (!locks || heldHere.has(projectId)) return false;
  try {
    return ((await locks.query()).held ?? []).some((lock) => lock.name === jobLockName(projectId));
  } catch (err) {
    console.warn('epubtrans: could not query job locks', err);
    return false;
  }
}

onCrossTabMessage((_projectId, message) => {
  if (message.type === 'job') void refreshJobLocks();
});

function startWatching(): () => void {
  const refresh = () => void refreshJobLocks();
  const timer = setInterval(refresh, POLL_MS);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && lockManager()) stopWatching = startWatching();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = undefined;
    }
  };
}

/** Whether another tab is currently running a translation job for the project. */
export function useJobRunningElsewhere(projectId: string): boolean {
  return useSyncExternalStore(subscribe, () => elsewhere.has(projectId));
}

function announce(projectId: string): void {
  broadcast(projectId, { type: 'job' });
  void refreshJobLocks();
}

/**
 * Runs `task` while holding the project's job lock. Resolves false without running it when another tab
 * holds the lock; otherwise resolves true once `task` settled (the lock is released at that point).
 */
export async function runWithJobLock(projectId: string, task: () => Promise<void>): Promise<boolean> {
  const locks = lockManager();
  if (!locks) {
    await task();
    return true;
  }
  let acquired = false;
  try {
    return await locks.request(jobLockName(projectId), { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      acquired = true;
      heldHere.add(projectId);
      announce(projectId);
      await task();
      return true;
    });
  } catch (err) {
    if (acquired) throw err;
    // The lock manager refused the request (e.g. an opaque or sandboxed origin): translate without the guard.
    console.warn('epubtrans: job lock unavailable, running without cross-tab exclusivity', err);
    await task();
    return true;
  } finally {
    if (acquired) {
      heldHere.delete(projectId);
      announce(projectId);
    }
  }
}
