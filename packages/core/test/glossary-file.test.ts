import { describe, expect, it } from 'vitest';
import { applyGlossaryImport, formatGlossaryFile, type GlossaryEntry, glossaryFileFormat, parseGlossaryFile } from '../src';

const entries: GlossaryEntry[] = [
  { term: 'Mr. Darcy', translation: 'Ngài Darcy', type: 'person', note: 'formal, "proud"', count: 12 },
  { term: 'Pemberley', translation: 'Pemberley', type: 'place' },
  { term: '=SUM(A1)', translation: 'tổng, cộng\ndòng mới' },
];

describe('glossary files', () => {
  it('picks the format from the file name', () => {
    expect(glossaryFileFormat('names.CSV')).toBe('csv');
    expect(glossaryFileFormat('names.tsv')).toBe('tsv');
    expect(glossaryFileFormat('names.txt')).toBe('tsv');
    expect(glossaryFileFormat('names.json')).toBe('json');
    expect(glossaryFileFormat('names.xlsx')).toBeUndefined();
  });

  for (const format of ['csv', 'tsv', 'json'] as const) {
    it(`round-trips ${format} (without counts) and guards spreadsheet formulas`, () => {
      const text = formatGlossaryFile(entries, format);
      if (format !== 'json') expect(text).toContain("'=SUM(A1)");
      const parsed = parseGlossaryFile(text, format);
      const expected = entries.map(({ count: _c, ...e }) =>
        format === 'tsv' && e.translation.includes('\n') ? { ...e, translation: 'tổng, cộng dòng mới' } : e,
      );
      expect(parsed).toEqual({ entries: expected, duplicates: 0 });
    });
  }

  it('reads headerless CSV by position, header CSV by name, skips blank rows and dedupes case- and accent-insensitively', () => {
    const headerless = parseGlossaryFile('Đà Nẵng,Da Nang,place\n\nda nang,Đà Nẵng 2\nLondon,Luân Đôn,,capital\n', 'csv');
    expect(headerless.entries).toEqual([
      { term: 'Đà Nẵng', translation: 'Da Nang', type: 'place' },
      { term: 'London', translation: 'Luân Đôn', note: 'capital' },
    ]);
    expect(headerless.duplicates).toBe(1);
    const named = parseGlossaryFile('﻿Note,Translation,Term\nhero,Anh hùng,Hero\n', 'csv');
    expect(named.entries).toEqual([{ term: 'Hero', translation: 'Anh hùng', note: 'hero' }]);
    expect(parseGlossaryFile('{"glossary":[{"term":"A","translation":"B"}]}', 'json').entries).toEqual([{ term: 'A', translation: 'B' }]);
  });

  it('rejects bad rows with the line or entry number', () => {
    expect(() => parseGlossaryFile('term,translation\nok,fine\nmissing,\n', 'csv')).toThrow('line 3: the translation of "missing" is empty');
    expect(() => parseGlossaryFile('a\tb\tmonster\n', 'tsv')).toThrow(/line 1: unknown type "monster"/);
    expect(() => parseGlossaryFile('"open,quote\n', 'csv')).toThrow(/not closed/);
    expect(() => parseGlossaryFile('[{"term":"x"}]', 'json')).toThrow('entry 1: the translation of "x" is empty');
    expect(() => parseGlossaryFile('[{"term":1,"translation":"x"}]', 'json')).toThrow(/must be text/);
    expect(() => parseGlossaryFile('{"x":1}', 'json')).toThrow(/expected an array/);
    expect(() => parseGlossaryFile('nope', 'json')).toThrow(/not valid JSON/);
    expect(() => parseGlossaryFile(`${'x'.repeat(301)},y`, 'csv')).toThrow(/longer than 300/);
  });

  it('merges with existing entries winning, or replaces', () => {
    const existing: GlossaryEntry[] = [{ term: 'Hero', translation: 'Người hùng', count: 3 }];
    const imported: GlossaryEntry[] = [
      { term: 'hero', translation: 'Anh hùng' },
      { term: 'Villain', translation: 'Kẻ ác' },
    ];
    expect(applyGlossaryImport(existing, imported, 'merge')).toEqual({ glossary: [existing[0], imported[1]], added: 1, skipped: 1 });
    expect(applyGlossaryImport(existing, imported, 'replace')).toEqual({ glossary: imported, added: 2, skipped: 0 });
  });
});
