import { PROVIDER_PRESETS } from '../providers/provider-presets';
import type { ProjectSettings, TokenUsage } from '../types';

/** Upper bound of a configurable cached-input price ratio (a ratio above 1 would be a premium, as for cache writes). */
export const MAX_CACHED_INPUT_RATIO = 2;

export type UsagePricing = Pick<ProjectSettings, 'providerId' | 'priceInPerM' | 'priceOutPerM' | 'cachedInputRatio'>;

/**
 * Price ratios applied to cached input: the book's `cachedInputRatio`, else the provider preset's documented ratio,
 * else 1 (priced like other input). Cache writes use the preset's ratio (Anthropic 1.25), else 1.
 */
export function cachePriceRatios(settings: Pick<ProjectSettings, 'providerId' | 'cachedInputRatio'>): { read: number; write: number } {
  const preset = PROVIDER_PRESETS.find((p) => p.id === settings.providerId);
  const own = settings.cachedInputRatio;
  const read = typeof own === 'number' && Number.isFinite(own) && own >= 0 ? own : (preset?.cachedInputRatio ?? 1);
  return { read, write: preset?.cacheWriteRatio ?? 1 };
}

/**
 * USD for the tokens actually used, or undefined without both prices. Cached reads and cache writes (parts of
 * `usage.input`) are priced with `cachePriceRatios`; the rest of the input at the input price.
 */
export function usageCostUsd(usage: TokenUsage, pricing: UsagePricing): number | undefined {
  const { priceInPerM: pin, priceOutPerM: pout } = pricing;
  if (typeof pin !== 'number' || typeof pout !== 'number') return undefined;
  const cached = Math.max(0, usage.cachedInput ?? 0);
  const written = Math.max(0, usage.cacheWriteInput ?? 0);
  const plain = Math.max(0, usage.input - cached - written);
  const { read, write } = cachePriceRatios(pricing);
  return ((plain + cached * read + written * write) * pin + usage.output * pout) / 1e6;
}

/** Adds `delta` into `total`; the optional cache counters appear only once a provider reported them. */
export function addUsage(total: TokenUsage, delta: TokenUsage): void {
  total.input += delta.input;
  total.output += delta.output;
  if (delta.cachedInput) total.cachedInput = (total.cachedInput ?? 0) + delta.cachedInput;
  if (delta.cacheWriteInput) total.cacheWriteInput = (total.cacheWriteInput ?? 0) + delta.cacheWriteInput;
}
