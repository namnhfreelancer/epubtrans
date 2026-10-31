import { foldGlossaryKey, GLOSSARY_TERM_TYPES, type GlossaryEntry, type GlossaryTermType } from '@epubtrans/core';

/** Type filter of the glossary table: every entry, one type, or entries without a type. */
export type GlossaryTypeFilter = 'all' | 'none' | GlossaryTermType;

export const GLOSSARY_TYPE_FILTERS: readonly GlossaryTypeFilter[] = ['all', ...GLOSSARY_TERM_TYPES, 'none'];

/** Rows per page: keeps the table fast with hundreds of entries (each row holds four inputs). */
export const GLOSSARY_PAGE_SIZE = 50;

/** An entry with its position in the full glossary, so edits on a filtered page update the right entry. */
export interface GlossaryRow {
  entry: GlossaryEntry;
  index: number;
}

export interface GlossaryPage {
  rows: GlossaryRow[];
  /** Matching entries over all pages. */
  matches: number;
  /** Current page (0-based, clamped to the available pages). */
  page: number;
  pages: number;
}

/**
 * Filters by type and by a case- and diacritics-insensitive query over term, translation and note
 * ("da nang" finds "Đà Nẵng"), then returns one page of the matches.
 */
export function glossaryPage(
  entries: readonly GlossaryEntry[],
  query: string,
  type: GlossaryTypeFilter,
  page: number,
  pageSize = GLOSSARY_PAGE_SIZE,
): GlossaryPage {
  const q = foldGlossaryKey(query);
  const matching: GlossaryRow[] = [];
  entries.forEach((entry, index) => {
    if (type === 'none' ? entry.type !== undefined : type !== 'all' && entry.type !== type) return;
    if (q && ![entry.term, entry.translation, entry.note ?? ''].some((field) => foldGlossaryKey(field).includes(q))) return;
    matching.push({ entry, index });
  });
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const current = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  return { rows: matching.slice(current * pageSize, (current + 1) * pageSize), matches: matching.length, page: current, pages };
}

/** Applies an edit to entry `index`, dropping optional fields that became empty. */
export function patchGlossaryEntry(entries: readonly GlossaryEntry[], index: number, patch: Partial<GlossaryEntry>): GlossaryEntry[] {
  return entries.map((entry, i) => {
    if (i !== index) return entry;
    const next: GlossaryEntry = { ...entry, ...patch };
    if (!next.note) delete next.note;
    if (!next.type) delete next.type;
    return next;
  });
}

/** Section headings (`##`/`###` lines) of a guideline with their character offsets, for quick navigation. */
export function guidelineSections(guideline: string): { title: string; offset: number }[] {
  const out: { title: string; offset: number }[] = [];
  let offset = 0;
  for (const line of guideline.split('\n')) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) out.push({ title: heading[1] as string, offset });
    offset += line.length + 1;
  }
  return out;
}
