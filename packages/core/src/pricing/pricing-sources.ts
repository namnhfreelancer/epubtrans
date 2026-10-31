import { isRecord, requestJson } from '../providers/provider-http';
import { perTokenToPerM } from './per-token-price';
import type { PricingEntry, PricingLoadContext, PricingSource } from './pricing-types';

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const LITELLM_PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** LiteLLM lists embeddings, images, audio and more; only text-generation models are relevant. */
const LITELLM_TEXT_MODES = new Set(['chat', 'completion', 'responses']);

/** OpenRouter `GET /models`: `pricing.prompt` / `pricing.completion` are USD per token, as strings. */
export function parseOpenRouterCatalog(json: unknown): PricingEntry[] {
  const data = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const entries: PricingEntry[] = [];
  for (const item of data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.pricing)) continue;
    const priceInPerM = perTokenToPerM(item.pricing.prompt);
    const priceOutPerM = perTokenToPerM(item.pricing.completion);
    if (priceInPerM === undefined || priceOutPerM === undefined) continue;
    const slash = item.id.indexOf('/');
    entries.push({
      id: item.id,
      priceInPerM,
      priceOutPerM,
      ...(slash > 0 ? { namespace: item.id.slice(0, slash).replace(/^~/, '').toLowerCase() } : {}),
    });
  }
  return entries;
}

/** LiteLLM `model_prices_and_context_window.json`: id -> `{ input_cost_per_token, output_cost_per_token, litellm_provider, mode }`. */
export function parseLiteLlmCatalog(json: unknown): PricingEntry[] {
  if (!isRecord(json)) return [];
  const entries: PricingEntry[] = [];
  for (const [id, item] of Object.entries(json)) {
    if (id === 'sample_spec' || !isRecord(item)) continue;
    if (typeof item.mode === 'string' && !LITELLM_TEXT_MODES.has(item.mode)) continue;
    const priceInPerM = perTokenToPerM(item.input_cost_per_token);
    const priceOutPerM = perTokenToPerM(item.output_cost_per_token);
    if (priceInPerM === undefined || priceOutPerM === undefined) continue;
    entries.push({
      id,
      priceInPerM,
      priceOutPerM,
      ...(typeof item.litellm_provider === 'string' ? { namespace: item.litellm_provider.toLowerCase() } : {}),
    });
  }
  return entries;
}

/**
 * Both catalogs are public: the request is a bare GET with only an `Accept` header, so neither an API key
 * nor any other credential can reach these hosts.
 */
async function loadPublicCatalog(url: string, parse: (json: unknown) => PricingEntry[], { fetchImpl, signal }: PricingLoadContext): Promise<PricingEntry[]> {
  const entries = parse(await requestJson(fetchImpl, url, { method: 'GET', headers: { accept: 'application/json' }, signal }));
  if (entries.length === 0) throw new Error(`No prices found in ${new URL(url).host} response`);
  return entries;
}

export const openRouterSource: PricingSource = { id: 'openrouter', load: (ctx) => loadPublicCatalog(OPENROUTER_MODELS_URL, parseOpenRouterCatalog, ctx) };
export const liteLlmSource: PricingSource = { id: 'litellm', load: (ctx) => loadPublicCatalog(LITELLM_PRICES_URL, parseLiteLlmCatalog, ctx) };

export const DEFAULT_PRICING_SOURCES: readonly PricingSource[] = [openRouterSource, liteLlmSource];
