import { readFile, stat } from 'node:fs/promises';
import { applyGlossaryImport, glossaryFileFormat, MAX_GLOSSARY_FILE_CHARS, type ProjectSettings, parseGlossaryFile } from '@epubtrans/core';
import { UsageError } from './args';
import type { Io } from './io';

/**
 * Merges the glossary file passed with `--glossary-file` into the settings: entries already in the project win (they may
 * hold edits), new terms are appended. The file is validated; an invalid one stops the command before any request.
 */
export async function applyGlossaryFile(settings: ProjectSettings, path: string | undefined, io: Io): Promise<ProjectSettings> {
  if (path === undefined) return settings;
  const format = glossaryFileFormat(path);
  if (!format) throw new UsageError(`--glossary-file ${path}: use a .csv, .tsv (or .txt) or .json file`);
  let text: string;
  try {
    // A glossary file is small; refuse anything far larger before reading it into memory (UTF-8 is at most 4 bytes a character).
    if ((await stat(path)).size > MAX_GLOSSARY_FILE_CHARS * 4) throw new UsageError(`--glossary-file ${path} is too large`);
    text = new TextDecoder().decode(await readFile(path));
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`Cannot read glossary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: ReturnType<typeof parseGlossaryFile>;
  try {
    parsed = parseGlossaryFile(text, format);
  } catch (err) {
    throw new UsageError(`Glossary file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = applyGlossaryImport(settings.glossary, parsed.entries, 'merge');
  const notes = [
    result.skipped > 0 ? `${result.skipped} already in the project (kept as they are)` : '',
    parsed.duplicates > 0 ? `${parsed.duplicates} duplicates in the file ignored` : '',
  ].filter(Boolean);
  io.err(`Glossary: ${result.added} entries added from ${path}${notes.length ? `; ${notes.join(', ')}` : ''}\n`);
  return { ...settings, glossary: result.glossary };
}
