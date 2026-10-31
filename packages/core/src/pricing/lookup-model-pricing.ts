import { isAbortError } from '../providers/provider-http';
import { matchModelPricing } from './match-model-pricing';
import { DEFAULT_PRICING_SOURCES } from './pricing-sources';
import type { LookupModelPricingOptions, ModelPricing, PricingEntry } from './pricing-types';

/**
 * Looks up USD-per-1M prices for `model` in public catalogs (OpenRouter, then LiteLLM). The requests are plain
 * unauthenticated GETs and carry neither the model name nor any key. A source that fails (offline, bad payload)
 * is skipped; an aborted `signal` rejects. Returns undefined when no source has an unambiguous match.
 */
export async function lookupModelPricing(model: string, opts: LookupModelPricingOptions = {}): Promise<ModelPricing | undefined> {
  const { presetId, signal } = opts;
  const fetchImpl = opts.fetchImpl ?? (((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch);
  for (const source of opts.sources ?? DEFAULT_PRICING_SOURCES) {
    let entries: PricingEntry[];
    try {
      entries = await source.load({ fetchImpl, signal });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      continue;
    }
    const match = matchModelPricing(entries, model, presetId);
    if (match) return { priceInPerM: match.priceInPerM, priceOutPerM: match.priceOutPerM, source: source.id, matchedId: match.id };
  }
  return undefined;
}
