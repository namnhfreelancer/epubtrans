/** Waits for a quiet moment of the main thread; the returned function withdraws the callback. */
export type IdleScheduler = (run: () => void) => () => void;

/** `requestIdleCallback` where it exists (Safari lacks it), else a macrotask. */
export const scheduleIdle: IdleScheduler = (run) => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 2000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, 0);
  return () => clearTimeout(handle);
};

export const ESTIMATE_DEBOUNCE_MS = 400;

export interface EstimateScheduler {
  /** Asks for a recomputation; a burst of requests collapses into one run after the burst ends. */
  request(): void;
  /** Drops a pending recomputation (unmount, or a run started that makes the result stale anyway). */
  cancel(): void;
}

/**
 * Debounced, off-the-critical-path recomputation: `compute` runs once, `delayMs` after the last `request()`,
 * and then only when the thread is idle. The cost estimate is expensive for large books while the project
 * changes on every finished segment and every keystroke, so it must never run per change.
 */
export function createEstimateScheduler<T>(options: {
  compute: () => T;
  onResult: (result: T) => void;
  delayMs?: number;
  idle?: IdleScheduler;
}): EstimateScheduler {
  const { compute, onResult, delayMs = ESTIMATE_DEBOUNCE_MS, idle = scheduleIdle } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelIdle: (() => void) | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    cancelIdle?.();
    cancelIdle = undefined;
  };

  return {
    request() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        cancelIdle = idle(() => {
          cancelIdle = undefined;
          onResult(compute());
        });
      }, delayMs);
    },
    cancel,
  };
}
