import type { GlossaryEntry, GlossaryTermType } from '../types';

/** Display and sort order of glossary term types. */
export const GLOSSARY_TERM_TYPES: readonly GlossaryTermType[] = ['person', 'place', 'organization', 'term', 'other'];

export const isGlossaryTermType = (value: unknown): value is GlossaryTermType => GLOSSARY_TERM_TYPES.includes(value as GlossaryTermType);

/**
 * Case-, diacritics- and whitespace-insensitive key of a term, used to dedupe glossary entries and to
 * search them ("Đà Nẵng" and "da nang" share a key). `đ` has no Unicode decomposition, so it is mapped by hand.
 */
export function foldGlossaryKey(term: string): string {
  return term.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Copy of `entry` without empty optional fields. */
export function cleanGlossaryEntry(entry: GlossaryEntry): GlossaryEntry {
  const out: GlossaryEntry = { term: entry.term.trim(), translation: entry.translation.trim() };
  const note = entry.note?.trim();
  if (note) out.note = note;
  if (entry.type) out.type = entry.type;
  if (entry.count !== undefined) out.count = entry.count;
  return out;
}
