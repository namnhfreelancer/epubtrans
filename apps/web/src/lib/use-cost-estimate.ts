import type { CostEstimate } from '@epubtrans/core';
import { type DependencyList, useEffect, useMemo, useRef, useState } from 'react';
import { createEstimateScheduler } from './estimate-scheduler';

export interface CostEstimateState {
  /** The last computed estimate; undefined until the first one is ready. */
  estimate: CostEstimate | undefined;
  /** A run is in progress, so `estimate` is deliberately not refreshed until it ends. */
  deferred: boolean;
}

/**
 * Keeps a cost estimate current without recomputing per project change: recomputation is debounced and runs
 * when the thread is idle. While `paused` (a translation or sample run) the last estimate is kept and only the
 * first one is computed; it is refreshed once the run ends. `deps` are everything `compute` reads.
 */
export function useCostEstimate(compute: () => CostEstimate, paused: boolean, deps: DependencyList): CostEstimateState {
  const [estimate, setEstimate] = useState<CostEstimate>();
  const hasEstimate = useRef(false);
  const computeRef = useRef(compute);
  const scheduler = useMemo(
    () =>
      createEstimateScheduler({
        compute: () => computeRef.current(),
        onResult: (result) => {
          hasEstimate.current = true;
          setEstimate(result);
        },
      }),
    [],
  );

  useEffect(() => () => scheduler.cancel(), [scheduler]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller lists everything `compute` reads in `deps`.
  useEffect(() => {
    computeRef.current = compute;
    if (paused && hasEstimate.current) return scheduler.cancel();
    scheduler.request();
  }, [scheduler, paused, ...deps]);

  return { estimate, deferred: paused && estimate !== undefined };
}
