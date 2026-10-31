import type { GlossaryEntry } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { glossaryPage, guidelineSections, patchGlossaryEntry } from '../src/lib/glossary-view';

const entries: GlossaryEntry[] = [
  { term: 'Harry', translation: 'Harry', type: 'person', count: 120 },
  { term: 'Đà Nẵng', translation: 'Da Nang', type: 'place', count: 4 },
  { term: 'wand', translation: 'đũa phép', type: 'term', note: 'magic stick' },
  { term: 'Gate', translation: 'Cổng' },
];

describe('glossaryPage', () => {
  it('searches term, translation and note ignoring case and diacritics', () => {
    expect(glossaryPage(entries, 'da nang', 'all', 0).rows.map((r) => r.index)).toEqual([1]);
    expect(glossaryPage(entries, 'DUA PHEP', 'all', 0).rows.map((r) => r.index)).toEqual([2]);
    expect(glossaryPage(entries, 'stick', 'all', 0).rows.map((r) => r.index)).toEqual([2]);
    expect(glossaryPage(entries, '  ', 'all', 0).matches).toBe(4);
  });

  it('filters by type, including entries without a type', () => {
    expect(glossaryPage(entries, '', 'person', 0).rows.map((r) => r.entry.term)).toEqual(['Harry']);
    expect(glossaryPage(entries, '', 'none', 0).rows.map((r) => r.entry.term)).toEqual(['Gate']);
    expect(glossaryPage(entries, 'harry', 'place', 0).matches).toBe(0);
  });

  it('pages hundreds of entries and keeps their positions in the full list', () => {
    const many: GlossaryEntry[] = Array.from({ length: 420 }, (_, i) => ({ term: `Term ${i}`, translation: `T${i}`, type: i % 2 ? 'term' : 'person' }));
    const last = glossaryPage(many, '', 'all', 99);
    expect(last).toMatchObject({ page: 8, pages: 9, matches: 420 });
    expect(last.rows).toHaveLength(20);
    expect(last.rows[0]?.index).toBe(400);
    const odd = glossaryPage(many, '', 'term', 1);
    expect(odd.rows[0]?.index).toBe(101);
    expect(odd.pages).toBe(5);
    expect(glossaryPage([], '', 'all', 3)).toEqual({ rows: [], matches: 0, page: 0, pages: 1 });
  });
});

describe('patchGlossaryEntry', () => {
  it('updates one entry and drops emptied optional fields', () => {
    const next = patchGlossaryEntry(entries, 2, { note: '', type: undefined, translation: 'đũa' });
    expect(next[2]).toEqual({ term: 'wand', translation: 'đũa' });
    expect(next[0]).toBe(entries[0]);
  });
});

describe('guidelineSections', () => {
  it('lists ## and ### headings with their offsets', () => {
    const text = '- base rule\n\n## Book-specific guideline\n\n### Genre & audience\n- x';
    expect(guidelineSections(text)).toEqual([
      { title: 'Book-specific guideline', offset: 13 },
      { title: 'Genre & audience', offset: 41 },
    ]);
  });
});
