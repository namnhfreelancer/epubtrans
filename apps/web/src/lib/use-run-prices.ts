import type { ProjectSettings } from '@epubtrans/core';
import type { ActiveProvider } from './provider-config-store';
import { type ModelPricingState, useModelPricing } from './use-model-pricing';

export interface RunPrices {
  /** USD per 1M tokens used for estimates: the book's manual price per field, else the automatic one. */
  priceInPerM?: number;
  priceOutPerM?: number;
  /** The automatic price: the provider's own model list (OpenRouter "Test connection") wins, else the public catalogs. */
  auto?: { priceInPerM?: number; priceOutPerM?: number };
  /** True when the provider published the price itself. */
  published: boolean;
  lookup: ModelPricingState;
}

/**
 * Prices for cost estimates. Manual prices saved with the book override the automatic one per field; nothing
 * automatic is persisted, so changing the model looks up a fresh price instead of keeping the previous model's.
 */
export function useRunPrices(settings: Pick<ProjectSettings, 'priceInPerM' | 'priceOutPerM'>, active: ActiveProvider): RunPrices {
  const published = active.priceInPerM !== undefined && active.priceOutPerM !== undefined;
  const lookup = useModelPricing(active.model, active.providerId);
  const auto = published
    ? { priceInPerM: active.priceInPerM, priceOutPerM: active.priceOutPerM }
    : lookup.status === 'found'
      ? { priceInPerM: lookup.pricing.priceInPerM, priceOutPerM: lookup.pricing.priceOutPerM }
      : undefined;
  return {
    priceInPerM: settings.priceInPerM ?? auto?.priceInPerM,
    priceOutPerM: settings.priceOutPerM ?? auto?.priceOutPerM,
    ...(auto ? { auto } : {}),
    published,
    lookup,
  };
}
