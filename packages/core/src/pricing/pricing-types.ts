/** One priced model from a public catalog. Prices are USD per 1M tokens. */
export interface PricingEntry {
  id: string;
  priceInPerM: number;
  priceOutPerM: number;
  /** Who offers the model: the id prefix on OpenRouter (`anthropic`), `litellm_provider` on LiteLLM. Lower case. */
  namespace?: string;
}

export type PricingSourceId = 'openrouter' | 'litellm';

export interface PricingLoadContext {
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

/** A public price catalog. `load` may throw (offline, bad payload); the lookup then moves on to the next source. */
export interface PricingSource {
  id: PricingSourceId;
  load(ctx: PricingLoadContext): Promise<PricingEntry[]>;
}

export interface ModelPricing {
  priceInPerM: number;
  priceOutPerM: number;
  source: PricingSourceId;
  /** The catalog id the model name was matched to, e.g. `anthropic/claude-opus-5.5`. */
  matchedId: string;
}

export interface LookupModelPricingOptions {
  /** Provider preset id; narrows fuzzy matches to that maker's models. */
  presetId?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Catalogs to consult, in order. Defaults to OpenRouter, then LiteLLM. */
  sources?: readonly PricingSource[];
}
