import { type CostEstimate, estimateSampleCost, type Project, type SampleSelection, selectSamplePassages } from '@epubtrans/core';
import { type ActiveProvider, settingsForRun } from './provider-config-store';
import { useCostEstimate } from './use-cost-estimate';

export interface SampleEstimateInput {
  project: Project;
  /** Bumped on every in-place project mutation (finished segment, guideline or glossary keystroke). */
  version: number;
  provider: Pick<ActiveProvider, 'providerId' | 'baseURL' | 'model'>;
  /** The stored sample; before the first run the estimate covers a preview selection of `passages` passages. */
  stored: SampleSelection | undefined;
  passages: number;
  /** A sample or full run is in progress: keep the last estimate instead of recomputing per finished segment. */
  paused: boolean;
}

/**
 * Cost of the next sample run. Picking the preview selection counts the words of the whole book, so it is
 * scheduled like the book estimate (debounced, when idle, not during runs) instead of running per project change.
 * Undefined until computed, and for a book without text to sample.
 */
export function useSampleEstimate({ project, version, provider, stored, passages, paused }: SampleEstimateInput): CostEstimate | undefined {
  const { providerId, baseURL, model } = provider;
  const { estimate } = useCostEstimate(
    () => {
      try {
        const selection = stored ?? selectSamplePassages(project, { passages, seed: 0 });
        return estimateSampleCost(project, settingsForRun(project.settings, { providerId, baseURL, model }), selection);
      } catch {
        return undefined; // a book without text has nothing to sample
      }
    },
    paused,
    [project, stored, passages, providerId, baseURL, model, version],
  );
  return estimate;
}
