import type { PricingEntry } from './pricing-types';

/** Maker names a preset's models appear under in the public catalogs (OpenRouter and LiteLLM spell Gemini differently). */
const PRESET_NAMESPACES: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['anthropic'],
  openai: ['openai'],
  gemini: ['google', 'gemini'],
  deepseek: ['deepseek'],
};

/** Lower case, drop any `maker/` prefix, and treat `.` `_` `:` and `-` alike (`claude-opus-5.5` == `claude-opus-5-5`). */
export function normalizeModelName(id: string): string {
  const base = id.trim().toLowerCase().split('/').pop() ?? '';
  return base.replace(/[._:\s]+/g, '-').replace(/-+/g, '-');
}

/**
 * Ids the fuzzy rules may pick: `/`-separated segments of letters, digits and `._~:@+-`. Anything else (control
 * characters, spaces, odd prefixes in a tampered catalog) only matches when the user typed that exact id.
 */
const PLAIN_ID = /^[\w.~:@+-]+(?:\/[\w.~:@+-]+)*$/;

/** `-20250514` and `-2025-05-14` release stamps. Expects a normalized name. */
const stripDateSuffix = (name: string): string => name.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, '');

/** Several entries that charge the same are not a guess; entries that charge differently are. */
function pickUnambiguous(pool: PricingEntry[]): PricingEntry | undefined {
  const [first] = pool;
  if (!first || pool.some((e) => e.priceInPerM !== first.priceInPerM || e.priceOutPerM !== first.priceOutPerM)) return undefined;
  return pool.reduce((best, e) => (e.id.length < best.id.length || (e.id.length === best.id.length && e.id < best.id) ? e : best));
}

/**
 * Finds the catalog entry for `model`, most specific rule first: exact id, `<maker>/<model>` for the preset,
 * normalized name (preferring the preset's maker), then normalized name without a trailing date stamp.
 * A rule that finds several differently priced candidates ends the search with `undefined` instead of guessing.
 */
export function matchModelPricing(entries: readonly PricingEntry[], model: string, presetId?: string): PricingEntry | undefined {
  const name = model.trim();
  if (!name) return undefined;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const exact = byId.get(name);
  if (exact) return exact;
  const namespaces = (presetId && PRESET_NAMESPACES[presetId]) || [];
  for (const ns of namespaces) {
    const prefixed = byId.get(`${ns}/${name}`);
    if (prefixed) return prefixed;
  }

  const normalized = entries.filter((entry) => PLAIN_ID.test(entry.id)).map((entry) => ({ entry, key: normalizeModelName(entry.id) }));
  const target = normalizeModelName(name);
  const withoutDate = stripDateSuffix(target);
  for (const wanted of withoutDate === target ? [target] : [target, withoutDate]) {
    const hits = normalized.filter((n) => n.key === wanted).map((n) => n.entry);
    if (hits.length === 0) continue;
    const ofPreset = hits.filter((e) => e.namespace !== undefined && namespaces.includes(e.namespace));
    return pickUnambiguous(ofPreset.length > 0 ? ofPreset : hits);
  }
  return undefined;
}
