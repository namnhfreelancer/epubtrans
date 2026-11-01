import {
  estimateSampleCost,
  type Project,
  type ProjectSettings,
  randomSampleSeed,
  type SampleRunResult,
  type SampleSelection,
  selectSamplePassages,
  type TokenUsage,
  translateSample,
} from '@epubtrans/core';
import { expectPositionals, parseArgs, UsageError } from '../args';
import { SAMPLE_FLAGS } from '../flag-specs';
import { applyGlossaryFile } from '../glossary-import';
import type { Io } from '../io';
import { confirmRun, EXIT } from '../pipeline';
import { lookupEstimatePrices } from '../price-lookup';
import { createProgress, formatTokens, formatUsd, tokensUsedLine, usageCost } from '../progress';
import { createProjectSaver, writeProjectFile } from '../project-store';
import { formatSampleReport } from '../sample-report';
import { applyRunFlags, selectProvider } from '../settings';
import { openProject } from './open-project';
import { buildProvider } from './provider-setup';

const USAGE =
  'epubtrans sample <input.(epub|mobi|azw3|fb2|txt|md) | project.epubtrans> [--passages N] [--words N] [--seed S] [--new] --to <lang> --model <id> [options]';

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
      ? `about ${formatUsd(usageCost({ input: estimate.inputTokens, output: estimate.outputTokens }, settings) ?? 0)}`
      : 'cost unknown (pass --price-in and --price-out, USD per 1M tokens, for a cost estimate)';
  return [
    `Sample: ${segments} segments in ${selection.passages.length} passages (seed ${selection.seed})${settings.twoPass ? ' (+ polish pass)' : ''}`,
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
  const opened = await openProject(input, flags, io, USAGE);
  const { project, projectPath } = opened;

  const selection = chooseSelection(project, { passages: flags.passages, words: flags.words, seed: flags.seed, fresh: flags.new });
  const provider = selectProvider(flags, opened.existing ? project.settings : undefined);
  const settings = await applyGlossaryFile(applyRunFlags(opened.settings, flags, provider), flags['glossary-file'], io);
  if (!settings.model) throw new UsageError('--model <id> is required. List the available models with: epubtrans models --provider <id>');
  const chat = await buildProvider(provider, flags['api-key-file'], settings.model, io, { reasoning: settings.reasoning });

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
  let usage: TokenUsage = { input: 0, output: 0 };
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

  io.err(tokensUsedLine(usage, priced));
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
