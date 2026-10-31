import type { ProjectSettings } from '@epubtrans/core';
import type { ActiveProvider } from './provider-config-store';
import { type RunPrices, resolveRunPrices } from './run-pricing';
import { type ModelPricingState, useModelPricing } from './use-model-pricing';

/**
 * React binding of `resolveRunPrices`: looks the active model up in the public catalogs and resolves the prices
 * for cost estimates (manual per field, else the provider's published price, else the catalog match).
 */
export function useRunPrices(settings: ProjectSettings, active: ActiveProvider): RunPrices & { lookup: ModelPricingState } {
  const lookup = useModelPricing(active.model, active.providerId);
  return { ...resolveRunPrices(settings, active, lookup.status === 'found' ? lookup.pricing : undefined), lookup };
}
