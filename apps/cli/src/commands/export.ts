import { exportEpub } from '@epubtrans/core';
import { expectPositionals, parseArgs } from '../args';
import { domEnv } from '../dom-env';
import { loadFontFile } from '../embedded-font-files';
import { EXPORT_FLAGS } from '../flag-specs';
import { applyWordWiseFlags, wordWiseExportNote } from '../hint-flags';
import type { Io } from '../io';
import { countStatuses } from '../progress';
import { writeFileAtomic } from '../project-store';
import { parseExportMode } from '../settings';
import { applyStyleFlags } from '../style-flags';
import { assertOutputIsSeparate, defaultOutPath } from './output-paths';
import { readProjectFile } from './resume';

const USAGE =
  'epubtrans export <file.epubtrans> [--mode bilingual|bilingual-translation-first|translation-only|original] [--out file.epub] [--word-wise] [hint options] [--style-file style.json] [--attribution]';

/**
 * Builds the EPUB from a project as it stands; untranslated segments keep their source text. Word Wise and style flags
 * apply to this export only (the project file is not changed).
 */
export async function exportCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, flags } = parseArgs(argv, EXPORT_FLAGS);
  const [file] = expectPositionals(positionals, 1, USAGE) as [string];
  const mode = parseExportMode(flags.mode);
  const project = await readProjectFile(file);
  const settings = await applyStyleFlags(applyWordWiseFlags(project.settings, flags), flags);
  const outPath = flags.out ?? defaultOutPath(file, mode === 'original' ? 'original' : project.settings.targetLang);
  assertOutputIsSeparate(outPath, file);
  const note = wordWiseExportNote(project, settings, mode, file);
  if (note) io.err(note);
  await writeFileAtomic(outPath, await exportEpub({ ...project, settings }, mode, domEnv, { loadFontFile }));
  const c = countStatuses(project);
  io.err(`Wrote ${outPath} (${mode}, ${c.done}/${c.total} segments translated)\n`);
  return 0;
}
