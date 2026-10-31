import { readFile } from 'node:fs/promises';
import {
  createDefaultSettings,
  detectLanguage,
  GUIDELINE_PRESETS,
  type GuidelinePresetId,
  getGuidelinePreset,
  importBook,
  loadProjectFile,
  type Project,
  type ProjectSettings,
} from '@epubtrans/core';
import { expectPositionals, parseArgs, UsageError } from '../args';
import { domEnv } from '../dom-env';
import { TRANSLATE_FLAGS } from '../flag-specs';
import type { Io } from '../io';
import { translateAndExport } from '../pipeline';
import { countStatuses } from '../progress';
import { applyRunFlags, parseExportMode, parseLanguage, selectProvider } from '../settings';
import { assertOutputIsSeparate, defaultOutPath, PROJECT_EXTENSION } from './output-paths';
import { buildProvider } from './provider-setup';

const USAGE = 'epubtrans translate <input.(epub|mobi|azw3|fb2)> --to <lang> --model <id> [options]';

export async function readBytes(path: string, what: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new UsageError(`Cannot read ${what} ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Style flags only make sense before the first segment is translated; afterwards they would change the book mid-way. */
async function resolveGuideline(flags: { 'guideline-preset'?: string; 'guideline-file'?: string }): Promise<string | undefined> {
  const file = flags['guideline-file'];
  if (file !== undefined) {
    const bytes = await readBytes(file, 'guideline file');
    const text = bytes ? new TextDecoder().decode(bytes).trim() : '';
    if (!text) throw new UsageError(`Guideline file ${file} is missing or empty`);
    return text;
  }
  const id = flags['guideline-preset'];
  if (id === undefined) return undefined;
  if (!GUIDELINE_PRESETS.some((p) => p.id === id))
    throw new UsageError(`Unknown guideline preset "${id}". Available: ${GUIDELINE_PRESETS.map((p) => p.id).join(', ')}`);
  return getGuidelinePreset(id as GuidelinePresetId).guideline;
}

export async function translateCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, flags } = parseArgs(argv, TRANSLATE_FLAGS);
  const [input] = expectPositionals(positionals, 1, USAGE) as [string];
  const mode = parseExportMode(flags.mode);
  const projectPath = flags.project ?? `${input}${PROJECT_EXTENSION}`;
  const guideline = await resolveGuideline(flags);

  const existingBytes = await readBytes(projectPath, 'project file');
  let project: Project;
  let settings: ProjectSettings;
  if (existingBytes) {
    project = await loadProjectFile(existingBytes);
    const c = countStatuses(project);
    io.err(`Resuming ${projectPath}: ${c.done}/${c.total} segments already translated\n`);
    if (flags.to !== undefined && parseLanguage(flags.to, '--to').toLowerCase() !== project.settings.targetLang.toLowerCase()) {
      throw new UsageError(`${projectPath} translates to "${project.settings.targetLang}", not "${flags.to}". Use another --project path or delete that file.`);
    }
    settings = { ...project.settings };
    if (flags.from !== undefined) settings.sourceLang = flags.from === 'auto' ? 'auto' : parseLanguage(flags.from, '--from');
    if ((guideline !== undefined || flags['generate-guide']) && c.done > 0) {
      io.err('Ignoring guideline options: translation already started, changing the style now would make the book inconsistent.\n');
    } else if (guideline !== undefined) {
      settings.guideline = guideline;
    }
  } else {
    if (flags.to === undefined) throw new UsageError(`--to <language> is required. Usage: ${USAGE}`);
    const bytes = await readBytes(input, 'input file');
    if (!bytes) throw new UsageError(`Input file not found: ${input}`);
    io.err(`Importing ${input} ...\n`);
    project = await importBook(bytes, input.split(/[\\/]/).pop() ?? input, domEnv);
    const total = countStatuses(project).total;
    io.err(`Imported "${project.title}": ${project.chapters.length} chapters, ${total} segments\n`);
    const requestedFrom = flags.from === undefined || flags.from === 'auto' ? 'auto' : parseLanguage(flags.from, '--from');
    const detected = requestedFrom === 'auto' ? detectLanguage(project) : requestedFrom;
    settings = createDefaultSettings({
      sourceLang: detected === 'und' ? 'auto' : detected,
      targetLang: parseLanguage(flags.to, '--to'),
      ...(guideline !== undefined ? { guideline } : {}),
    });
    if (requestedFrom === 'auto') io.err(`Source language: ${detected === 'und' ? 'unknown (the model will detect it)' : `${detected} (auto-detected)`}\n`);
  }

  const selection = selectProvider(flags, existingBytes ? project.settings : undefined);
  settings = applyRunFlags(settings, flags, selection);
  if (!settings.model) throw new UsageError('--model <id> is required. List the available models with: epubtrans models --provider <id>');
  const provider = await buildProvider(selection, flags['api-key-file'], settings.model, io);

  const outPath = flags.out ?? defaultOutPath(input, settings.targetLang);
  assertOutputIsSeparate(outPath, input, projectPath);
  return translateAndExport({
    project,
    projectPath,
    settings,
    provider,
    outPath,
    mode,
    generateGuide: flags['generate-guide'] === true && (!existingBytes || countStatuses(project).done === 0),
    yes: flags.yes === true,
    io,
  });
}
