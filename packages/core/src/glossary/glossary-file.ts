import type { GlossaryEntry } from '../types';
import { cleanGlossaryEntry, foldGlossaryKey, GLOSSARY_TERM_TYPES, isGlossaryTermType } from './glossary-entry';

/**
 * Glossary files for reuse across books (a series shares its names): CSV and TSV with the columns
 * `term, translation, type, note` (header optional) and JSON (an array of entries, or `{ "glossary": [...] }`).
 * Files come from anywhere, so imports are validated (errors name the line or entry) and deduplicated.
 */
export type GlossaryFileFormat = 'csv' | 'tsv' | 'json';
export type GlossaryImportMode = 'merge' | 'replace';

export const GLOSSARY_FILE_COLUMNS = ['term', 'translation', 'type', 'note'] as const;
export const MAX_GLOSSARY_FILE_CHARS = 5_000_000;
export const MAX_GLOSSARY_FILE_ENTRIES = 20_000;
const MAX_TERM_CHARS = 300;
const MAX_TRANSLATION_CHARS = 1000;
const MAX_NOTE_CHARS = 2000;

export class GlossaryFileError extends Error {
  override readonly name = 'GlossaryFileError';
}

/** Format implied by a file name (`.csv`, `.tsv`/`.tab`/`.txt`, `.json`), or undefined. */
export function glossaryFileFormat(fileName: string): GlossaryFileFormat | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv' || ext === 'tab' || ext === 'txt') return 'tsv';
  if (ext === 'json') return 'json';
  return undefined;
}

/** Spreadsheets run cells starting with these as formulas; exported cells get a leading `'`, which import removes. */
const FORMULA_START = /^[=+\-@\t\r]/;
const guardCell = (value: string) => (FORMULA_START.test(value) ? `'${value}` : value);
const unguardCell = (value: string) => (value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value);

function csvCell(value: string): string {
  const guarded = guardCell(value);
  return /[",\n\r]|^\s|\s$/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Serializes a glossary. `count` (a property of the source book) is not exported. */
export function formatGlossaryFile(entries: readonly GlossaryEntry[], format: GlossaryFileFormat): string {
  const rows = entries.map((e) => [e.term, e.translation, e.type ?? '', e.note ?? '']);
  if (format === 'json') {
    const list = entries.map((e) => ({ term: e.term, translation: e.translation, ...(e.type ? { type: e.type } : {}), ...(e.note ? { note: e.note } : {}) }));
    return `${JSON.stringify(list, null, 2)}\n`;
  }
  if (format === 'tsv') {
    // TSV has no quoting: tabs and line breaks inside a value become spaces.
    const cell = (v: string) => guardCell(v.replace(/[\t\r\n]+/g, ' '));
    return `${[[...GLOSSARY_FILE_COLUMNS], ...rows].map((r) => r.map(cell).join('\t')).join('\n')}\n`;
  }
  return `${[[...GLOSSARY_FILE_COLUMNS], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** RFC 4180 rows with their starting line numbers (quoted cells may span lines). */
function parseCsv(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      rows.push({ cells, line: rowLine });
      cells = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (quoted) throw new GlossaryFileError(`line ${rowLine}: a quoted value is not closed`);
  if (cell !== '' || cells.length) {
    cells.push(cell);
    rows.push({ cells, line: rowLine });
  }
  return rows;
}

const parseTsv = (text: string) => text.split(/\r\n|\n|\r/).map((l, i) => ({ cells: l.split('\t'), line: i + 1 }));

function checkLength(value: string, max: number, what: string, where: string): string {
  if (value.length > max) throw new GlossaryFileError(`${where}: ${what} is longer than ${max} characters`);
  return value;
}

/** Validates one raw entry; returns undefined for an empty row. */
function toEntry(raw: { term?: unknown; translation?: unknown; type?: unknown; note?: unknown }, where: string): GlossaryEntry | undefined {
  const field = (name: string, value: unknown): string => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw new GlossaryFileError(`${where}: "${name}" must be text`);
    return unguardCell(value.trim());
  };
  const term = checkLength(field('term', raw.term), MAX_TERM_CHARS, 'the term', where);
  const translation = checkLength(field('translation', raw.translation), MAX_TRANSLATION_CHARS, 'the translation', where);
  const type = field('type', raw.type).toLowerCase();
  const note = checkLength(field('note', raw.note), MAX_NOTE_CHARS, 'the note', where);
  if (!term && !translation && !type && !note) return undefined;
  if (!term) throw new GlossaryFileError(`${where}: the term is empty`);
  if (!translation) throw new GlossaryFileError(`${where}: the translation of "${term.slice(0, 60)}" is empty`);
  if (type && !isGlossaryTermType(type)) throw new GlossaryFileError(`${where}: unknown type "${type.slice(0, 30)}" (use ${GLOSSARY_TERM_TYPES.join(', ')})`);
  return cleanGlossaryEntry({ term, translation, ...(type && isGlossaryTermType(type) ? { type } : {}), ...(note ? { note } : {}) });
}

function rowsToEntries(rows: { cells: string[]; line: number }[]): { entry: GlossaryEntry | undefined }[] {
  const first = rows.find((r) => r.cells.some((c) => c.trim() !== ''));
  const header = first?.cells.map((c) => c.trim().toLowerCase().replace(/^﻿/, ''));
  const named = header?.includes('term') && header.includes('translation');
  const column = (name: (typeof GLOSSARY_FILE_COLUMNS)[number]) => (named ? (header?.indexOf(name) ?? -1) : GLOSSARY_FILE_COLUMNS.indexOf(name));
  const index = { term: column('term'), translation: column('translation'), type: column('type'), note: column('note') };
  return rows
    .filter((r) => !(named && r === first))
    .map((r) => {
      const at = (i: number) => (i >= 0 ? r.cells[i] : undefined);
      return { entry: toEntry({ term: at(index.term), translation: at(index.translation), type: at(index.type), note: at(index.note) }, `line ${r.line}`) };
    });
}

function jsonToEntries(text: string): { entry: GlossaryEntry | undefined }[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new GlossaryFileError(`not valid JSON: ${(err as Error).message}`);
  }
  const list = Array.isArray(json) ? json : typeof json === 'object' && json !== null ? (json as { glossary?: unknown }).glossary : undefined;
  if (!Array.isArray(list)) throw new GlossaryFileError('expected an array of entries or { "glossary": [...] }');
  return list.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new GlossaryFileError(`entry ${i + 1}: must be an object`);
    return { entry: toEntry(item as Record<string, unknown>, `entry ${i + 1}`) };
  });
}

export interface ParsedGlossaryFile {
  /** Valid entries in file order, without duplicates (the first occurrence of a term wins). */
  entries: GlossaryEntry[];
  /** Entries dropped because the same term (case- and diacritics-insensitive) appeared earlier in the file. */
  duplicates: number;
}

/** Parses and validates a glossary file. Throws `GlossaryFileError` naming the first bad line or entry. */
export function parseGlossaryFile(text: string, format: GlossaryFileFormat): ParsedGlossaryFile {
  if (text.length > MAX_GLOSSARY_FILE_CHARS) throw new GlossaryFileError(`the file is larger than ${MAX_GLOSSARY_FILE_CHARS / 1_000_000} MB`);
  const body = text.replace(/^﻿/, '');
  const rows = format === 'json' ? jsonToEntries(body) : rowsToEntries(format === 'csv' ? parseCsv(body) : parseTsv(body));
  const seen = new Set<string>();
  const entries: GlossaryEntry[] = [];
  let duplicates = 0;
  for (const { entry } of rows) {
    if (!entry) continue;
    const key = foldGlossaryKey(entry.term);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }
  if (entries.length > MAX_GLOSSARY_FILE_ENTRIES) throw new GlossaryFileError(`more than ${MAX_GLOSSARY_FILE_ENTRIES} entries`);
  return { entries, duplicates };
}

export interface GlossaryImportResult {
  glossary: GlossaryEntry[];
  /** Imported entries that were added. */
  added: number;
  /** Imported entries skipped because the glossary already had the term (merge only). */
  skipped: number;
}

/**
 * Combines an imported glossary with the book's: `merge` keeps every existing entry (it may hold the user's edits) in its
 * order and appends imported terms the glossary does not have yet; `replace` uses the imported entries alone.
 */
export function applyGlossaryImport(existing: readonly GlossaryEntry[], imported: readonly GlossaryEntry[], mode: GlossaryImportMode): GlossaryImportResult {
  if (mode === 'replace') return { glossary: [...imported], added: imported.length, skipped: 0 };
  const known = new Set(existing.map((e) => foldGlossaryKey(e.term)).filter(Boolean));
  const fresh = imported.filter((e) => !known.has(foldGlossaryKey(e.term)));
  return { glossary: [...existing, ...fresh], added: fresh.length, skipped: imported.length - fresh.length };
}
