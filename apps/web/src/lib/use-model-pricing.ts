import { DEFAULT_PRICING_SOURCES, lookupModelPricing, type ModelPricing, type PricingSource, withPricingCache } from '@epubtrans/core';
import { useEffect, useState } from 'react';
import { browserStorage } from './safe-storage';

/**
 * Public price catalogs, cached for 24h in localStorage under a namespaced key. Only the parsed
 * id -> price rows are stored (a few hundred KB), never the multi-MB raw responses.
 */
export const pricingSources: readonly PricingSource[] = DEFAULT_PRICING_SOURCES.map((source) =>
  withPricingCache(source, { storage: browserStorage(), keyPrefix: 'epubtrans:pricing:v1:' }),
);

export type ModelPricingState = { status: 'idle' | 'loading' | 'none' } | { status: 'found'; pricing: ModelPricing };

/**
 * Looks up the public price of `model` whenever it (or the provider) changes. Failures (offline, blocked
 * hosts) end as 'none' so the UI falls back to manual entry. Nothing user-specific is sent: the catalogs
 * are plain GETs, and the match happens locally.
 */
export function useModelPricing(model: string, providerId: string): ModelPricingState {
  const [state, setState] = useState<ModelPricingState>({ status: 'idle' });
  useEffect(() => {
    const name = model.trim();
    if (!name) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    lookupModelPricing(name, { presetId: providerId, sources: pricingSources, signal: controller.signal })
      .then((pricing) => {
        if (!controller.signal.aborted) setState(pricing ? { status: 'found', pricing } : { status: 'none' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'none' });
      });
    return () => controller.abort();
  }, [model, providerId]);
  return state;
}
