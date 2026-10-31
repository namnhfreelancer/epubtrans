import { lookupModelPricing, type ProjectSettings } from '@epubtrans/core';
import type { Io } from './io';

export interface EstimatePrices {
  priceInPerM?: number;
  priceOutPerM?: number;
}

const SOURCE_LABELS = { openrouter: 'OpenRouter', litellm: 'LiteLLM' } as const;

/**
 * Fills the prices the user did not provide (`--price-in/--price-out` or the project file) from public catalogs.
 * The lookup is a plain unauthenticated GET to openrouter.ai / raw.githubusercontent.com: no API key and no
 * book data leave the machine, so it may run before the user confirms. Failures leave the prices unset.
 */
export async function lookupEstimatePrices(settings: ProjectSettings, io: Io, enabled: boolean): Promise<EstimatePrices> {
  if (!enabled || (settings.priceInPerM !== undefined && settings.priceOutPerM !== undefined)) return {};
  let found: Awaited<ReturnType<typeof lookupModelPricing>>;
  try {
    found = await lookupModelPricing(settings.model, { presetId: settings.providerId, fetchImpl: io.fetch, signal: io.signal });
  } catch (err) {
    if (io.signal.aborted) throw err;
    found = undefined; // prices are optional; an unreachable catalog must not block translating
  }
  if (!found) {
    io.err(`No public price found for "${settings.model}" (pass --price-in and --price-out for a cost estimate)\n`);
    return {};
  }
  io.err(`Prices from ${SOURCE_LABELS[found.source]} (matched: ${found.matchedId}): $${found.priceInPerM}/M input, $${found.priceOutPerM}/M output\n`);
  return { priceInPerM: settings.priceInPerM ?? found.priceInPerM, priceOutPerM: settings.priceOutPerM ?? found.priceOutPerM };
}
