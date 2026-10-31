import {
  createDefaultSettings,
  detectLanguage,
  estimateSampleCost,
  importBook,
  loadProjectFile,
  type Project,
  type ProjectSettings,
  randomSampleSeed,
  type SampleRunResult,
  type SampleSelection,
  selectSamplePassages,
  translateSample,
} from '@epubtrans/core';
import { expectPositionals, parseArgs, UsageError } from '../args';
import { domEnv } from '../dom-env';
import { SAMPLE_FLAGS } from '../flag-specs';
import type { Io } from '../io';
import { confirmRun, EXIT } from '../pipeline';
import { lookupEstimatePrices } from '../price-lookup';
import { countStatuses, createProgress, formatTokens, formatUsd, usageCost } from '../progress';
import { createProjectSaver, writeProjectFile } from '../project-store';
import { formatSampleReport } from '../sample-report';
import { applyRunFlags, parseLanguage, selectProvider } from '../settings';
import { PROJECT_EXTENSION } from './output-paths';
import { buildProvider } from './provider-setup';
import { readBytes } from './translate';

const USAGE =
  'epubtrans sample <input.(epub|mobi|azw3|fb2) | project.epubtrans> [--passages N] [--words N] [--seed S] [--new] --to <lang> --model <id> [options]';

interface Opened {
  project: Project;
  projectPath: string;
  settings: ProjectSettings;
  existing: boolean;
}

/** Loads the project (a `.epubtrans` input, or the file saved next to a book by `translate`/`sample`) or imports the book. */
async function openProject(input: string, flags: { project?: string; to?: string; from?: string }, io: Io): Promise<Opened> {
  const isProjectFile = input.toLowerCase().endsWith(PROJECT_EXTENSION);
  const projectPath = isProjectFile ? input : (flags.project ?? `${input}${PROJECT_EXTENSION}`);
  const existingBytes = await readBytes(projectPath, 'project file');
  if (isProjectFile && !existingBytes) throw new UsageError(`Project file not found: ${input}`);

  if (existingBytes) {
    let project: Project;
    try {
      project = await loadProjectFile(existingBytes);
    } catch (err) {
      throw new UsageError(`${projectPath} is not a valid epubtrans project: ${err instanceof Error ? err.message : String(err)}`);
    }
    const c = countStatuses(project);
    io.err(`Using ${projectPath}: ${c.done}/${c.total} segments already translated\n`);
    if (flags.to !== undefined && parseLanguage(flags.to, '--to').toLowerCase() !== project.settings.targetLang.toLowerCase()) {
      throw new UsageError(`${projectPath} translates to "${project.settings.targetLang}", not "${flags.to}". Use another --project path or delete that file.`);
    }
    const settings = { ...project.settings };
    if (flags.from !== undefined) settings.sourceLang = flags.from === 'auto' ? 'auto' : parseLanguage(flags.from, '--from');
    return { project, projectPath, settings, existing: true };
  }

  if (flags.to === undefined) throw new UsageError(`--to <language> is required for a new project. Usage: ${USAGE}`);
  const bytes = await readBytes(input, 'input file');
  if (!bytes) throw new UsageError(`Input file not found: ${input}`);
  io.err(`Importing ${input} ...\n`);
  const project = await importBook(bytes, input.split(/[\\/]/).pop() ?? input, domEnv);
  io.err(`Imported "${project.title}": ${project.chapters.length} chapters, ${countStatuses(project).total} segments\n`);
  const requestedFrom = flags.from === undefined || flags.from === 'auto' ? 'auto' : parseLanguage(flags.from, '--from');
  const detected = requestedFrom === 'auto' ? detectLanguage(project) : requestedFrom;
  const settings = createDefaultSettings({ sourceLang: detected === 'und' ? 'auto' : detected, targetLang: parseLanguage(flags.to, '--to') });
  return { project, projectPath, settings, existing: false };
}

interface SampleChoice {
  passages?: number;
  words?: number;
  seed?: number;
  fresh?: boolean;
}

/**
 * Which passages to translate. Without any selection flag the stored sample of the project is translated
 * again (so it can be compared after a guideline or glossary change); `--seed`, `--passages`, `--words` or
 * `--new` pick passages anew (`--new` with a fresh random seed, otherwise with the stored seed).
 */
function chooseSelection(project: Project, flags: SampleChoice): SampleSelection {
  const stored = project.lastSample;
  if (stored && flags.passages === undefined && flags.words === undefined && flags.seed === undefined && !flags.fresh) return stored;
  try {
    return selectSamplePassages(project, {
      ...(flags.passages !== undefined ? { passages: flags.passages } : {}),
      ...(flags.words !== undefined ? { wordsPerPassage: flags.words } : {}),
      seed: flags.seed ?? (flags.fresh ? randomSampleSeed() : (stored?.seed ?? randomSampleSeed())),
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

function describeEstimate(project: Project, settings: ProjectSettings, selection: SampleSelection): string {
  const estimate = estimateSampleCost(project, settings, selection);
  const segments = selection.passages.reduce((n, p) => n + p.segmentIds.length, 0);
  const cost =
    settings.priceInPerM !== undefined && settings.priceOutPerM !== undefined
      ? `about ${formatUsd(usageCost({ input: estimate.inputTokens, output: estimate.outputTokens }, settings.priceInPerM, settings.priceOutPerM) ?? 0)}`
      : 'cost unknown (pass --price-in and --price-out, USD per 1M tokens, for a cost estimate)';
  return [
    `Sample: ${segments} segments in ${selection.passages.length} passages (seed ${selection.seed})${settings.twoPass ? ' (+ review pass)' : ''}`,
    `Model: ${settings.model} via ${settings.baseURL}`,
    `Estimated usage: ~${formatTokens(estimate.inputTokens)} input / ~${formatTokens(estimate.outputTokens)} output tokens, ${cost}`,
  ].join('\n');
}

/**
 * Translates a few passages from different parts of the book, prints each as source/translation pairs and
 * saves them in the project file, so a later `translate` or `resume` skips them.
 */
export async function sampleCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, flags } = parseArgs(argv, SAMPLE_FLAGS);
  const [input] = expectPositionals(positionals, 1, USAGE) as [string];
  const opened = await openProject(input, flags, io);
  const { project, projectPath } = opened;

  const selection = chooseSelection(project, { passages: flags.passages, words: flags.words, seed: flags.seed, fresh: flags.new });
  const provider = selectProvider(flags, opened.existing ? project.settings : undefined);
  const settings = applyRunFlags(opened.settings, flags, provider);
  if (!settings.model) throw new UsageError('--model <id> is required. List the available models with: epubtrans models --provider <id>');
  const chat = await buildProvider(provider, flags['api-key-file'], settings.model, io);

  project.settings = settings;
  await writeProjectFile(project, projectPath);
  const looked = await lookupEstimatePrices(settings, io, flags['no-price-lookup'] !== true);
  // Looked-up prices feed the estimate and the cost shown while running; like `translate`, they are not saved.
  const priced: ProjectSettings = { ...settings, ...looked };
  io.err(`${describeEstimate(project, priced, selection)}\n`);
  if (!(await confirmRun(io, flags.yes === true))) {
    io.err(`Cancelled. Project saved to ${projectPath}; no translation request was made.\n`);
    return EXIT.failure;
  }

  const stop = new AbortController();
  const signal = AbortSignal.any([io.signal, stop.signal]);
  const saver = createProjectSaver(project, projectPath, (err) => stop.abort(err));
  const progress = createProgress(io, priced);
  let usage = { input: 0, output: 0 };
  let failure: unknown;
  let result: SampleRunResult | undefined;
  try {
    result = await translateSample(project, chat, settings, {
      selection,
      signal,
      onSegment: () => saver.markDirty(),
      onProgress: (p) => {
        usage = p.usage;
        progress.update(p);
      },
    });
  } catch (err) {
    failure = err;
  }
  progress.finish();
  // Persist whatever finished, even after an abort or a fatal error.
  await saver.flush();

  const cost = usageCost(usage, priced.priceInPerM, priced.priceOutPerM);
  io.err(`Tokens used: ${formatTokens(usage.input)} in / ${formatTokens(usage.output)} out${cost === undefined ? '' : ` (${formatUsd(cost)})`}\n`);
  if (failure !== undefined) {
    if (!io.signal.aborted) throw failure;
    io.err(`Interrupted. Progress saved to ${projectPath}.\n`);
    return EXIT.interrupted;
  }

  const failed = result?.failed ?? [];
  const keptEdited = result?.keptEdited ?? [];
  io.out(formatSampleReport(project, selection, { failed, keptEdited }));
  io.err(
    `Sample saved to ${projectPath}. To judge it again after changing the style, run the same command; ` +
      `"epubtrans translate ${input}" or "epubtrans resume ${projectPath}" translates the rest and keeps these segments.\n`,
  );
  if (keptEdited.length > 0) io.err(`${keptEdited.length} edited segments kept (segments you edited by hand are never re-translated by a sample).\n`);
  if (failed.length > 0) {
    io.err(`${failed.length} sample segments failed (see above; earlier translations were kept); run the same command to retry.\n`);
    return EXIT.incomplete;
  }
  return EXIT.ok;
}
