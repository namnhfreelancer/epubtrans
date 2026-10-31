import type { GlossaryEntry } from '../types';
import { cleanGlossaryEntry, foldGlossaryKey, GLOSSARY_TERM_TYPES } from './glossary-entry';

/** Default upper bound of generated glossary entries. */
export const DEFAULT_GLOSSARY_CAP = 400;
/** Every book gets room for at least this many entries (still bounded by the cap). */
export const MIN_GLOSSARY_ENTRIES = 30;
/** One entry per this many source tokens, about 500 English words. */
export const SOURCE_TOKENS_PER_ENTRY = 650;

/**
 * Number of glossary entries a book of `sourceTokens` tokens gets: `min(cap, max(30, ceil(tokens / 650)))`,
 * i.e. roughly one entry per 500 words. A 3k-word essay gets 30, a 100k-word novel about 200,
 * a 1000-page book (≈300k words) reaches the default cap of 400.
 */
export function glossaryLimit(sourceTokens: number, cap = DEFAULT_GLOSSARY_CAP): number {
  const max = Number.isFinite(cap) ? Math.max(1, Math.floor(cap)) : DEFAULT_GLOSSARY_CAP;
  return Math.min(max, Math.max(MIN_GLOSSARY_ENTRIES, Math.ceil(Math.max(0, sourceTokens) / SOURCE_TOKENS_PER_ENTRY)));
}

const typeRank = (e: GlossaryEntry) => (e.type ? GLOSSARY_TERM_TYPES.indexOf(e.type) : GLOSSARY_TERM_TYPES.length);

/** Glossary order: by type (person, place, organization, term, other, untyped), then most frequent first, then term. */
export function compareGlossaryEntries(a: GlossaryEntry, b: GlossaryEntry): number {
  return typeRank(a) - typeRank(b) || (b.count ?? 0) - (a.count ?? 0) || foldGlossaryKey(a.term).localeCompare(foldGlossaryKey(b.term), 'en');
}

/**
 * Merges generated entries into the existing glossary. Existing entries always stay (they may hold the
 * user's edits) and win over generated duplicates; duplicates are detected case- and diacritics-insensitively.
 * Generated entries fill the remaining room up to `limit`, most frequent first. The result is sorted with
 * `compareGlossaryEntries`.
 */
export function mergeGlossary(existing: readonly GlossaryEntry[], generated: readonly GlossaryEntry[], limit: number): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  const take = (entry: GlossaryEntry): boolean => {
    const clean = cleanGlossaryEntry(entry);
    const key = foldGlossaryKey(clean.term);
    if (!key || !clean.translation || seen.has(key)) return false;
    seen.add(key);
    out.push(clean);
    return true;
  };
  for (const entry of existing) take(entry);
  const byFrequency = [...generated].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  for (const entry of byFrequency) {
    if (out.length >= limit) break;
    take(entry);
  }
  return out.sort(compareGlossaryEntries);
}
