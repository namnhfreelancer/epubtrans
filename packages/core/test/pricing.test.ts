import { describe, expect, it, vi } from 'vitest';
import { lookupModelPricing, type PricingEntry, type PricingSource, withPricingCache } from '../src';
import { isCacheFresh, PRICING_CACHE_TTL_MS, parseCatalogCache, serializeCatalogCache } from '../src/pricing/cached-pricing-source';
import { matchModelPricing, normalizeModelName } from '../src/pricing/match-model-pricing';
import { perTokenToPerM } from '../src/pricing/per-token-price';
import { liteLlmSource, openRouterSource, parseLiteLlmCatalog, parseOpenRouterCatalog } from '../src/pricing/pricing-sources';

/** Small excerpts shaped like the live responses (OpenRouter strings per token, LiteLLM numbers per token). */
const OPENROUTER_FIXTURE = {
  data: [
    { id: 'anthropic/claude-opus-5.5', pricing: { prompt: '0.000005', completion: '0.000025', input_cache_read: '0.0000005' } },
    { id: 'anthropic/claude-opus-5.5:batch', pricing: { prompt: '0.0000025', completion: '0.0000125' } },
    { id: 'openai/gpt-6-luna', pricing: { prompt: '0.0000015', completion: '0.000006' } },
    { id: 'openai/gpt-6-luna:batch', pricing: { prompt: '0.00000075', completion: '0.000003' } },
    { id: 'anthropic/claude-sonnet-4', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'google/gemini-2.5-pro', pricing: { prompt: '0.00000125', completion: '0.00001' } },
    { id: 'deepseek/deepseek-chat', pricing: { prompt: '0.0000003', completion: '0.0000012' } },
    { id: 'acme/twin-model', pricing: { prompt: '0.000001', completion: '0.000002' } },
    { id: 'other/twin-model', pricing: { prompt: '0.000009', completion: '0.000018' } },
    { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
    { id: 'broken/no-pricing' },
  ],
};

const LITELLM_FIXTURE = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, litellm_provider: 'one of ...', mode: 'one of: chat' },
  'claude-3-7-sonnet-20250219': { input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5, litellm_provider: 'anthropic', mode: 'chat' },
  'github_copilot/claude-3.7-sonnet': { input_cost_per_token: 9e-6, output_cost_per_token: 9e-5, litellm_provider: 'github_copilot', mode: 'chat' },
  'text-embedding-3-small': { input_cost_per_token: 2e-8, output_cost_per_token: 0, litellm_provider: 'openai', mode: 'embedding' },
  'gemini/gemini-2.5-flash': { input_cost_per_token: 3e-7, output_cost_per_token: 2.5e-6, litellm_provider: 'gemini', mode: 'chat' },
  'gpt-lite-only': { input_cost_per_token: 4e-7, output_cost_per_token: 1.6e-6, litellm_provider: 'openai', mode: 'chat' },
};

const openRouterEntries = parseOpenRouterCatalog(OPENROUTER_FIXTURE);
const liteLlmEntries = parseLiteLlmCatalog(LITELLM_FIXTURE);

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function fixtureFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url === 'https://openrouter.ai/api/v1/models') return json(OPENROUTER_FIXTURE);
    if (url.startsWith('https://raw.githubusercontent.com/BerriAI/litellm/')) return json(LITELLM_FIXTURE);
    return new Response('nope', { status: 404 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('per-token to per-1M conversion', () => {
  it('converts strings and numbers, rounding away float noise', () => {
    expect(perTokenToPerM('0.000005')).toBe(5);
    expect(perTokenToPerM(2.5e-5)).toBe(25);
    expect(perTokenToPerM('0.00000125')).toBe(1.25);
    expect(perTokenToPerM(0)).toBe(0);
  });

  it('rejects negative, empty and non-numeric values', () => {
    for (const bad of ['-1', -1, '', '  ', 'abc', undefined, null, {}, Number.NaN, '1e999']) expect(perTokenToPerM(bad)).toBeUndefined();
  });
});

describe('catalog parsing', () => {
  it('reads OpenRouter pricing and skips routers and unpriced models', () => {
    expect(openRouterEntries.find((e) => e.id === 'anthropic/claude-opus-5.5')).toEqual({
      id: 'anthropic/claude-opus-5.5',
      priceInPerM: 5,
      priceOutPerM: 25,
      namespace: 'anthropic',
    });
    expect(openRouterEntries.map((e) => e.id)).not.toContain('openrouter/auto');
    expect(openRouterEntries.map((e) => e.id)).not.toContain('broken/no-pricing');
  });

  it('reads LiteLLM text models only', () => {
    expect(liteLlmEntries.map((e) => e.id)).toEqual([
      'claude-3-7-sonnet-20250219',
      'github_copilot/claude-3.7-sonnet',
      'gemini/gemini-2.5-flash',
      'gpt-lite-only',
    ]);
    expect(liteLlmEntries[0]).toEqual({ id: 'claude-3-7-sonnet-20250219', priceInPerM: 3, priceOutPerM: 15, namespace: 'anthropic' });
  });

  it('tolerates malformed payloads', () => {
    expect(parseOpenRouterCatalog(null)).toEqual([]);
    expect(parseOpenRouterCatalog({ data: 'x' })).toEqual([]);
    expect(parseLiteLlmCatalog([])).toEqual([]);
  });
});

describe('model matching', () => {
  it('prefers the exact id', () => {
    expect(matchModelPricing(openRouterEntries, 'openai/gpt-6-luna')?.id).toBe('openai/gpt-6-luna');
    expect(matchModelPricing(openRouterEntries, 'openai/gpt-6-luna:batch')?.id).toBe('openai/gpt-6-luna:batch');
  });

  it('adds the preset maker prefix', () => {
    expect(matchModelPricing(openRouterEntries, 'claude-sonnet-4', 'anthropic')?.id).toBe('anthropic/claude-sonnet-4');
    expect(matchModelPricing(openRouterEntries, 'gemini-2.5-pro', 'gemini')?.id).toBe('google/gemini-2.5-pro');
    expect(matchModelPricing(openRouterEntries, 'deepseek-chat', 'deepseek')?.id).toBe('deepseek/deepseek-chat');
  });

  it('matches normalized names across . - _ : and case, without confusing variants', () => {
    expect(normalizeModelName('Anthropic/Claude_Opus-5.5')).toBe('claude-opus-5-5');
    expect(matchModelPricing(openRouterEntries, 'claude-opus-5-5', 'anthropic')?.id).toBe('anthropic/claude-opus-5.5');
    expect(matchModelPricing(openRouterEntries, 'CLAUDE-OPUS-5.5')?.id).toBe('anthropic/claude-opus-5.5');
    expect(matchModelPricing(openRouterEntries, 'gpt-6-luna')?.id).toBe('openai/gpt-6-luna');
    expect(matchModelPricing(openRouterEntries, 'gpt-6-luna:batch')?.id).toBe('openai/gpt-6-luna:batch');
  });

  it('strips a date suffix only as a fallback', () => {
    expect(matchModelPricing(openRouterEntries, 'claude-sonnet-4-20250514', 'anthropic')?.id).toBe('anthropic/claude-sonnet-4');
    expect(matchModelPricing(openRouterEntries, 'claude-sonnet-4-2025-05-14')?.id).toBe('anthropic/claude-sonnet-4');
    // An entry that carries the date itself wins over the stripped name.
    expect(matchModelPricing(liteLlmEntries, 'claude-3-7-sonnet-20250219', 'anthropic')?.id).toBe('claude-3-7-sonnet-20250219');
    expect(matchModelPricing(liteLlmEntries, 'claude-9-sonnet-20991231', 'anthropic')).toBeUndefined();
  });

  it('prefers the preset maker among normalized candidates', () => {
    expect(matchModelPricing(liteLlmEntries, 'claude-3.7-sonnet-20250219', 'anthropic')?.id).toBe('claude-3-7-sonnet-20250219');
    expect(matchModelPricing(liteLlmEntries, 'claude-3.7-sonnet', 'anthropic')?.id).toBe('github_copilot/claude-3.7-sonnet');
  });

  it('returns undefined instead of guessing between differently priced matches', () => {
    expect(matchModelPricing(openRouterEntries, 'twin-model')).toBeUndefined();
    expect(matchModelPricing(openRouterEntries, 'twin-model', 'openai')).toBeUndefined();
    expect(matchModelPricing(openRouterEntries, 'unknown-model')).toBeUndefined();
    expect(matchModelPricing(openRouterEntries, '   ')).toBeUndefined();
  });

  it('accepts several matches that charge the same', () => {
    const entries: PricingEntry[] = [
      { id: 'a/m-1', priceInPerM: 1, priceOutPerM: 2 },
      { id: 'b/m.1', priceInPerM: 1, priceOutPerM: 2 },
    ];
    expect(matchModelPricing(entries, 'm-1')?.id).toBe('a/m-1');
  });
});

describe('lookupModelPricing', () => {
  it('returns USD per 1M with source and matched id, using OpenRouter first', async () => {
    const { fetchImpl, calls } = fixtureFetch();
    const result = await lookupModelPricing('claude-opus-5-5', { presetId: 'anthropic', fetchImpl });
    expect(result).toEqual({ priceInPerM: 5, priceOutPerM: 25, source: 'openrouter', matchedId: 'anthropic/claude-opus-5.5' });
    expect(calls.map((c) => c.url)).toEqual(['https://openrouter.ai/api/v1/models']);
  });

  it('falls back to LiteLLM when OpenRouter has no match or fails', async () => {
    const { fetchImpl } = fixtureFetch();
    expect(await lookupModelPricing('gpt-lite-only', { presetId: 'openai', fetchImpl })).toEqual({
      priceInPerM: 0.4,
      priceOutPerM: 1.6,
      source: 'litellm',
      matchedId: 'gpt-lite-only',
    });
    const offlineFirst = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('openrouter.ai')) throw new TypeError('offline');
      return json(LITELLM_FIXTURE);
    }) as unknown as typeof fetch;
    expect((await lookupModelPricing('gpt-lite-only', { fetchImpl: offlineFirst }))?.source).toBe('litellm');
  });

  it('returns undefined when nothing matches or every source fails', async () => {
    expect(await lookupModelPricing('no-such-model', { fetchImpl: fixtureFetch().fetchImpl })).toBeUndefined();
    const down = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await lookupModelPricing('gpt-6-luna', { fetchImpl: down })).toBeUndefined();
    const garbage = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await lookupModelPricing('gpt-6-luna', { fetchImpl: garbage })).toBeUndefined();
  });

  it('sends plain GETs with no credentials, key or body', async () => {
    const { fetchImpl, calls } = fixtureFetch();
    await lookupModelPricing('no-such-model', { fetchImpl });
    expect(calls.map((c) => c.url)).toEqual([
      'https://openrouter.ai/api/v1/models',
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    ]);
    for (const { init } of calls) {
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(Object.keys((init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase())).toEqual(['accept']);
    }
  });

  it('rethrows an abort instead of treating it as "no price"', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    await expect(lookupModelPricing('gpt-6-luna', { fetchImpl, signal: controller.signal })).rejects.toThrow();
  });

  it('honours injected sources and their order', async () => {
    const mk = (id: 'openrouter' | 'litellm', entries: PricingEntry[]): PricingSource => ({ id, load: async () => entries });
    const first = mk('litellm', [{ id: 'm', priceInPerM: 1, priceOutPerM: 2 }]);
    const second = mk('openrouter', [{ id: 'm', priceInPerM: 9, priceOutPerM: 9 }]);
    expect((await lookupModelPricing('m', { sources: [first, second] }))?.source).toBe('litellm');
  });
});

describe('default sources against fixtures', () => {
  it('load through the shared HTTP helper and reject empty catalogs', async () => {
    const { fetchImpl } = fixtureFetch();
    expect((await openRouterSource.load({ fetchImpl })).length).toBe(openRouterEntries.length);
    expect((await liteLlmSource.load({ fetchImpl })).length).toBe(liteLlmEntries.length);
    const empty = vi.fn(async () => json({ data: [] })) as unknown as typeof fetch;
    await expect(openRouterSource.load({ fetchImpl: empty })).rejects.toThrow();
  });
});

describe('pricing cache', () => {
  const ENTRIES: PricingEntry[] = [
    { id: 'anthropic/claude-opus-5.5', priceInPerM: 5, priceOutPerM: 25, namespace: 'anthropic' },
    { id: 'plain', priceInPerM: 1, priceOutPerM: 2 },
  ];

  it('freshness: 24h TTL, future timestamps are not trusted', () => {
    expect(PRICING_CACHE_TTL_MS).toBe(86_400_000);
    expect(isCacheFresh(1000, 1000)).toBe(true);
    expect(isCacheFresh(1000, 1000 + PRICING_CACHE_TTL_MS - 1)).toBe(true);
    expect(isCacheFresh(1000, 1000 + PRICING_CACHE_TTL_MS)).toBe(false);
    expect(isCacheFresh(2000, 1000)).toBe(false);
  });

  it('round-trips compact rows and rejects corrupt data', () => {
    const raw = serializeCatalogCache(ENTRIES, 42);
    expect(parseCatalogCache(raw)).toEqual({ savedAt: 42, entries: ENTRIES });
    expect(raw).not.toContain('priceInPerM');
    for (const bad of [null, '', 'not json', '{"v":2,"savedAt":1,"rows":[]}', '{"v":1,"savedAt":"x","rows":[]}', '{"v":1,"savedAt":1,"rows":[["a","b",1]]}']) {
      expect(parseCatalogCache(bad)).toBeUndefined();
    }
  });

  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }
  const countingSource = (entries = ENTRIES) => {
    const load = vi.fn(async () => entries);
    return { load, source: { id: 'openrouter', load } as PricingSource };
  };
  const ctx = { fetchImpl: fetch };

  it('downloads once, stores the parsed map, and serves it until the TTL ends', async () => {
    let now = 1_000_000;
    const storage = memoryStorage();
    const inner = countingSource();
    const cached = withPricingCache(inner.source, { storage, keyPrefix: 'epubtrans:pricing:', now: () => now });
    expect(await cached.load(ctx)).toEqual(ENTRIES);
    expect(storage.data.has('epubtrans:pricing:openrouter')).toBe(true);

    now += PRICING_CACHE_TTL_MS - 1;
    await cached.load(ctx);
    // A new wrapper (a fresh page load) reads the stored copy instead of downloading.
    await withPricingCache(inner.source, { storage, keyPrefix: 'epubtrans:pricing:', now: () => now }).load(ctx);
    expect(inner.load).toHaveBeenCalledTimes(1);

    now += 1;
    await withPricingCache(inner.source, { storage, keyPrefix: 'epubtrans:pricing:', now: () => now }).load(ctx);
    expect(inner.load).toHaveBeenCalledTimes(2);
  });

  it('serves stale data when the refresh fails, and fails when there is nothing cached', async () => {
    let now = 0;
    const storage = memoryStorage({ 'p:openrouter': serializeCatalogCache(ENTRIES, 0) });
    now = PRICING_CACHE_TTL_MS * 3;
    const failing: PricingSource = {
      id: 'openrouter',
      load: async () => {
        throw new Error('offline');
      },
    };
    expect(await withPricingCache(failing, { storage, keyPrefix: 'p:', now: () => now }).load(ctx)).toEqual(ENTRIES);
    await expect(withPricingCache(failing, { storage: memoryStorage(), keyPrefix: 'p:', now: () => now }).load(ctx)).rejects.toThrow('offline');
  });

  it('keeps working without storage or when storage throws', async () => {
    const inner = countingSource();
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    for (const storage of [undefined, throwing]) {
      const cached = withPricingCache(inner.source, { storage, keyPrefix: 'p:' });
      expect(await cached.load(ctx)).toEqual(ENTRIES);
      await cached.load(ctx);
    }
    // One download per wrapper: the in-memory copy covers repeated lookups.
    expect(inner.load).toHaveBeenCalledTimes(2);
  });

  it('ignores a corrupt cache entry and refetches', async () => {
    const storage = memoryStorage({ 'p:openrouter': '{broken' });
    const inner = countingSource();
    expect(await withPricingCache(inner.source, { storage, keyPrefix: 'p:' }).load(ctx)).toEqual(ENTRIES);
    expect(inner.load).toHaveBeenCalledTimes(1);
  });
});
