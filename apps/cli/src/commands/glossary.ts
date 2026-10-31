import { formatGlossaryFile, type GlossaryFileFormat, glossaryFileFormat } from '@epubtrans/core';
import { expectPositionals, parseArgs, UsageError } from '../args';
import { GLOSSARY_EXPORT_FLAGS } from '../flag-specs';
import type { Io } from '../io';
import { writeFileAtomic } from '../project-store';
import { assertOutputIsSeparate } from './output-paths';
import { readProjectFile } from './resume';

const USAGE = 'epubtrans glossary export <file.epubtrans> --out <glossary.csv|.tsv|.json> [--format csv|tsv|json]';
const FORMATS: readonly GlossaryFileFormat[] = ['csv', 'tsv', 'json'];

/** `glossary export`: writes a project's glossary as CSV, TSV or JSON, for reuse with `--glossary-file` or the web app. */
export async function glossaryCommand(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'export') throw new UsageError(sub === undefined ? `Missing subcommand. Usage: ${USAGE}` : `Unknown subcommand "${sub}". Usage: ${USAGE}`);
  const { positionals, flags } = parseArgs(rest, GLOSSARY_EXPORT_FLAGS);
  const [file] = expectPositionals(positionals, 1, USAGE) as [string];
  if (!flags.out) throw new UsageError(`--out <file> is required. Usage: ${USAGE}`);
  const format = flags.format !== undefined ? FORMATS.find((f) => f === flags.format?.toLowerCase()) : glossaryFileFormat(flags.out);
  if (!format) {
    throw new UsageError(
      flags.format !== undefined
        ? `Unknown --format "${flags.format}". Use one of: ${FORMATS.join(', ')}`
        : `Pass --format, or use a .csv, .tsv or .json --out file`,
    );
  }
  assertOutputIsSeparate(flags.out, file);
  const project = await readProjectFile(file, io);
  await writeFileAtomic(flags.out, new TextEncoder().encode(formatGlossaryFile(project.settings.glossary, format)));
  io.err(`Wrote ${project.settings.glossary.length} glossary entries to ${flags.out} (${format})\n`);
  return 0;
}
