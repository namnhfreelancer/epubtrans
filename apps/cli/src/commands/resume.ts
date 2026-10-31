import { readFile } from 'node:fs/promises';
import { expectPositionals, parseArgs, UsageError } from '../args';
import { RESUME_FLAGS } from '../flag-specs';
import { applyWordWiseFlags } from '../hint-flags';
import type { Io } from '../io';
import { translateAndExport } from '../pipeline';
import { countStatuses } from '../progress';
import { applyRunFlags, parseExportMode, selectProvider } from '../settings';
import { applyStyleFlags, loadProjectFileWithWarnings } from '../style-flags';
import { assertOutputIsSeparate, defaultOutPath } from './output-paths';
import { buildProvider } from './provider-setup';

const USAGE = 'epubtrans resume <file.epubtrans> [--model <id>] [--out file.epub] [options]';

/** Reads and validates a project file (from the web app or an earlier CLI run). */
export async function readProjectFile(path: string, io: Io) {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (err) {
    throw new UsageError(`Cannot read project file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return await loadProjectFileWithWarnings(bytes, path, io);
  } catch (err) {
    throw new UsageError(`${path} is not a valid epubtrans project: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Continues a project: segments that are already translated or reviewed are skipped. */
export async function resumeCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, flags } = parseArgs(argv, RESUME_FLAGS);
  const [file] = expectPositionals(positionals, 1, USAGE) as [string];
  const mode = parseExportMode(flags.mode);
  const project = await readProjectFile(file, io);
  const c = countStatuses(project);
  io.err(`Project "${project.title}" -> ${project.settings.targetLang}: ${c.done}/${c.total} segments translated\n`);

  const selection = selectProvider(flags, project.settings);
  const settings = await applyStyleFlags(applyWordWiseFlags(applyRunFlags(project.settings, flags, selection), flags), flags, io);
  if (!settings.model) throw new UsageError('This project has no model yet. Pass --model <id> (list them with: epubtrans models --provider <id>)');
  const provider = await buildProvider(selection, flags['api-key-file'], settings.model, io, { reasoning: settings.reasoning });

  const outPath = flags.out ?? defaultOutPath(file, settings.targetLang);
  assertOutputIsSeparate(outPath, file);
  return translateAndExport({
    project,
    projectPath: file,
    settings,
    provider,
    outPath,
    mode,
    priceLookup: flags['no-price-lookup'] !== true,
    yes: flags.yes === true,
    io,
  });
}
