import { type CostEstimate, estimateCost, lookupModelPricing, type ModelPricing, type Project, type ProjectSettings } from '@epubtrans/core';
import { type ActiveProvider, settingsForRun } from './provider-config-store';
import { pricingSources } from './use-model-pricing';

/** USD per 1M tokens used for a run's estimate, and where they came from. */
export interface RunPrices {
  priceInPerM?: number;
  priceOutPerM?: number;
  /** The automatic price: published by the provider's model list, else found in the public catalogs. */
  auto?: { priceInPerM?: number; priceOutPerM?: number };
  /** The provider's own model list published the price (OpenRouter "Test connection"). */
  published: boolean;
  /** The book carries a manually entered price (it wins over the automatic one per field). */
  manual: boolean;
}

/**
 * Resolves the prices for a run: manual prices saved with the book override the automatic one per field; the
 * provider's own model list wins over a catalog match (`found`). Nothing automatic is persisted, so changing the
 * model looks up a fresh price instead of keeping the previous model's.
 */
export function resolveRunPrices(settings: ProjectSettings, active: ActiveProvider, found: ModelPricing | undefined): RunPrices {
  const published = active.priceInPerM !== undefined && active.priceOutPerM !== undefined;
  const auto = published
    ? { priceInPerM: active.priceInPerM, priceOutPerM: active.priceOutPerM }
    : found
      ? { priceInPerM: found.priceInPerM, priceOutPerM: found.priceOutPerM }
      : undefined;
  return {
    priceInPerM: settings.priceInPerM ?? auto?.priceInPerM,
    priceOutPerM: settings.priceOutPerM ?? auto?.priceOutPerM,
    ...(auto ? { auto } : {}),
    published,
    manual: settings.priceInPerM !== undefined || settings.priceOutPerM !== undefined,
  };
}

/** Token and cost estimate of the book's remaining work with the configured provider and the resolved prices. */
export function estimateRunCost(project: Project, active: ActiveProvider, prices: Pick<RunPrices, 'priceInPerM' | 'priceOutPerM'>): CostEstimate {
  const { providerId, baseURL, model } = active;
  return estimateCost(project, {
    ...settingsForRun(project.settings, { providerId, baseURL, model }),
    priceInPerM: prices.priceInPerM,
    priceOutPerM: prices.priceOutPerM,
  });
}

/**
 * Looks up the public catalog price of the active model outside React (the setup page uses `useModelPricing`).
 * Never rejects: offline or blocked catalogs, or an unknown model, resolve undefined.
 */
export async function lookupRunPricing(active: ActiveProvider, signal?: AbortSignal): Promise<ModelPricing | undefined> {
  const name = active.model.trim();
  if (!name) return undefined;
  try {
    return (await lookupModelPricing(name, { presetId: active.providerId, sources: pricingSources, ...(signal ? { signal } : {}) })) ?? undefined;
  } catch {
    return undefined;
  }
}
