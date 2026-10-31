import { isRecord } from '../providers/provider-http';
import type { PricingEntry, PricingSource } from './pricing-types';

/** localStorage-like surface; injected so core stays environment-agnostic. */
export interface PricingCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PRICING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;

export interface CachedCatalog {
  savedAt: number;
  entries: PricingEntry[];
}

/** Compact stored form: `[id, in, out, namespace?]` rows, never the multi-MB raw catalog response. */
type Row = [string, number, number, string?];

export function serializeCatalogCache(entries: readonly PricingEntry[], savedAt: number): string {
  const rows: Row[] = entries.map((e) =>
    e.namespace === undefined ? [e.id, e.priceInPerM, e.priceOutPerM] : [e.id, e.priceInPerM, e.priceOutPerM, e.namespace],
  );
  return JSON.stringify({ v: CACHE_VERSION, savedAt, rows });
}

/** Returns undefined for missing, corrupt or wrong-version data. */
export function parseCatalogCache(raw: string | null): CachedCatalog | undefined {
  if (raw === null) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(json) || json.v !== CACHE_VERSION || typeof json.savedAt !== 'number' || !Array.isArray(json.rows)) return undefined;
  const entries: PricingEntry[] = [];
  for (const row of json.rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'number' || typeof row[2] !== 'number') return undefined;
    entries.push({ id: row[0], priceInPerM: row[1], priceOutPerM: row[2], ...(typeof row[3] === 'string' ? { namespace: row[3] } : {}) });
  }
  return { savedAt: json.savedAt, entries };
}

/** A cache entry is fresh while younger than the TTL; one dated in the future (clock change) is not trusted. */
export const isCacheFresh = (savedAt: number, now: number, ttlMs = PRICING_CACHE_TTL_MS): boolean => now >= savedAt && now - savedAt < ttlMs;

export interface CachedSourceOptions {
  storage: PricingCacheStorage | undefined;
  /** Namespaced storage key prefix, e.g. `epubtrans:pricing:`; the source id is appended. */
  keyPrefix: string;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Wraps a source with a TTL cache: fresh data skips the network; when the refresh fails, stale data is still
 * better than none. Parsed rows are kept in memory too, so missing or full storage does not cause a re-download per lookup.
 */
export function withPricingCache(source: PricingSource, opts: CachedSourceOptions): PricingSource {
  const { storage, keyPrefix, ttlMs = PRICING_CACHE_TTL_MS, now = Date.now } = opts;
  const key = `${keyPrefix}${source.id}`;
  let memory: CachedCatalog | undefined;
  const readCached = (): CachedCatalog | undefined => {
    if (memory) return memory;
    try {
      memory = parseCatalogCache(storage?.getItem(key) ?? null);
    } catch {
      memory = undefined;
    }
    return memory;
  };
  return {
    id: source.id,
    async load(ctx) {
      const cached = readCached();
      if (cached && isCacheFresh(cached.savedAt, now(), ttlMs)) return cached.entries;
      try {
        const entries = await source.load(ctx);
        memory = { savedAt: now(), entries };
        try {
          storage?.setItem(key, serializeCatalogCache(entries, memory.savedAt));
        } catch {
          // Quota or disabled storage: the in-memory copy still serves this session.
        }
        return entries;
      } catch (err) {
        if (cached && !ctx.signal?.aborted) return cached.entries;
        throw err;
      }
    },
  };
}
