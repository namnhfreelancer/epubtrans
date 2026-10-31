import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEstimateScheduler, ESTIMATE_DEBOUNCE_MS, type IdleScheduler } from '../src/lib/estimate-scheduler';

/** An idle scheduler the test releases by hand, so "off the critical path" is observable. */
function manualIdle() {
  const queue: (() => void)[] = [];
  const idle: IdleScheduler = (run) => {
    queue.push(run);
    return () => {
      const at = queue.indexOf(run);
      if (at >= 0) queue.splice(at, 1);
    };
  };
  const flush = () => {
    for (const run of queue.splice(0)) run();
  };
  return { idle, queue, flush };
}

describe('estimate scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst of project updates into a single recompute', () => {
    const compute = vi.fn(() => 'estimate');
    const onResult = vi.fn();
    const { idle, flush } = manualIdle();
    const scheduler = createEstimateScheduler({ compute, onResult, idle });

    // 200 updates (finished segments, keystrokes), 50 ms apart: always inside the debounce window.
    for (let i = 0; i < 200; i++) {
      scheduler.request();
      vi.advanceTimersByTime(50);
    }
    expect(compute).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS);
    flush();
    expect(compute).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledExactlyOnceWith('estimate');
  });

  it('does not compute on the timer tick itself, only when the idle callback runs', () => {
    const compute = vi.fn(() => 1);
    const { idle, queue, flush } = manualIdle();
    const scheduler = createEstimateScheduler({ compute, onResult: () => {}, idle });
    scheduler.request();
    vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS);
    expect(queue).toHaveLength(1);
    expect(compute).not.toHaveBeenCalled();
    flush();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('a request that arrives while waiting for idle replaces the waiting one', () => {
    const compute = vi.fn(() => 1);
    const { idle, queue, flush } = manualIdle();
    const scheduler = createEstimateScheduler({ compute, onResult: () => {}, idle });
    scheduler.request();
    vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS);
    scheduler.request();
    expect(queue).toHaveLength(0);
    vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS);
    flush();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a pending recompute, both before the timer and while waiting for idle', () => {
    const compute = vi.fn(() => 1);
    const { idle, flush } = manualIdle();
    const scheduler = createEstimateScheduler({ compute, onResult: () => {}, idle });
    scheduler.request();
    scheduler.cancel();
    vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS * 2);
    flush();
    expect(compute).not.toHaveBeenCalled();

    scheduler.request();
    vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS);
    scheduler.cancel();
    flush();
    expect(compute).not.toHaveBeenCalled();
  });

  it('computes again for a request made after the previous run finished', () => {
    const compute = vi.fn(() => 1);
    const { idle, flush } = manualIdle();
    const scheduler = createEstimateScheduler({ compute, onResult: () => {}, idle });
    for (let round = 0; round < 2; round++) {
      scheduler.request();
      vi.advanceTimersByTime(ESTIMATE_DEBOUNCE_MS);
      flush();
    }
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
