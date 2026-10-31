import {
  type ChatProvider,
  type ExportMode,
  estimateCost,
  exportEpub,
  generateGuide,
  type Project,
  type ProjectSettings,
  type TokenUsage,
  translateProject,
} from '@epubtrans/core';
import { UsageError } from './args';
import { domEnv } from './dom-env';
import type { Io } from './io';
import { lookupEstimatePrices } from './price-lookup';
import { countStatuses, createProgress, formatTokens, formatUsd, usageCost } from './progress';
import { createProjectSaver, writeFileAtomic, writeProjectFile } from './project-store';

export const EXIT = { ok: 0, failure: 1, usage: 2, incomplete: 3, interrupted: 130 } as const;

export interface PipelineOptions {
  project: Project;
  projectPath: string;
  settings: ProjectSettings;
  provider: ChatProvider;
  outPath: string;
  mode: ExportMode;
  /** Ask the model for a book-specific guideline and glossary, after the user confirmed the run. */
  generateGuide?: boolean;
  /** Look up missing prices in public catalogs (`--no-price-lookup` turns it off). Default: true. */
  priceLookup?: boolean;
  yes: boolean;
  io: Io;
}

export async function confirmRun(io: Io, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!io.interactive) throw new UsageError('Not running in a terminal: pass --yes to start without confirmation.');
  return /^y(es)?$/i.test((await io.prompt('Proceed? [y/N] ')).trim());
}

function describeEstimate(project: Project, settings: ProjectSettings, todo: number, withGuide: boolean): string {
  const estimate = estimateCost(project, settings);
  const cost =
    estimate.usd !== undefined ? `about ${formatUsd(estimate.usd)}` : 'cost unknown (pass --price-in and --price-out, USD per 1M tokens, for a cost estimate)';
  return [
    `Segments to translate: ${todo}${settings.twoPass ? ' (+ review pass)' : ''}`,
    ...(withGuide ? ['Plus one extra request to generate the style guideline and glossary (not included in the estimate)'] : []),
    `Model: ${settings.model} via ${settings.baseURL}`,
    `Estimated usage: ~${formatTokens(estimate.inputTokens)} input / ~${formatTokens(estimate.outputTokens)} output tokens, ${cost}`,
  ].join('\n');
}

/**
 * Shared tail of `translate` and `resume`: estimate and confirm, translate the pending segments while
 * saving the project file continuously, then export the EPUB. Returns the process exit code.
 */
export async function translateAndExport(opts: PipelineOptions): Promise<number> {
  const { project, projectPath, provider, outPath, mode, io } = opts;
  project.settings = opts.settings;
  await writeProjectFile(project, projectPath);

  const before = countStatuses(project);
  const todo = before.pending + before.error;
  if (todo > 0) {
    // Looked-up prices only feed the estimate and the cost shown while running; they are not saved, so a later
    // run with another model never inherits them.
    const looked = await lookupEstimatePrices(opts.settings, io, opts.priceLookup !== false);
    const priced = (settings: ProjectSettings): ProjectSettings => ({ ...settings, ...looked });
    io.err(`${describeEstimate(project, priced(opts.settings), todo, opts.generateGuide === true)}\n`);
    if (!(await confirmRun(io, opts.yes))) {
      io.err(`Cancelled. Project saved to ${projectPath}; no translation request was made.\n`);
      return EXIT.failure;
    }
    // Everything that contacts the provider happens after the confirmation above.
    let settings = opts.settings;
    if (opts.generateGuide) {
      io.err('Generating style guideline and glossary ...\n');
      const guide = await generateGuide(project, provider, settings, io.signal);
      settings = { ...settings, guideline: guide.guideline, glossary: guide.glossary };
      io.err(`Guide ready: ${guide.glossary.length} glossary entries\n`);
    }
    project.settings = settings;
    await writeProjectFile(project, projectPath);
    const interrupted = await runTranslation(opts, priced(settings));
    if (interrupted) return EXIT.interrupted;
  } else {
    io.err('Every segment is already translated; exporting.\n');
  }

  const epub = await exportEpub(project, mode, domEnv);
  await writeFileAtomic(outPath, epub);
  const after = countStatuses(project);
  io.err(`Wrote ${outPath} (${mode}, ${after.done}/${after.total} segments translated)\n`);
  if (after.pending + after.error > 0) {
    io.err(`${after.pending + after.error} segments are not translated (they keep their source text). Re-run the same command to retry them.\n`);
    return EXIT.incomplete;
  }
  return EXIT.ok;
}

/** Returns true when interrupted by the user (progress is saved). Throws on fatal provider or save errors. */
async function runTranslation(opts: PipelineOptions, settings: ProjectSettings): Promise<boolean> {
  const { project, projectPath, provider, io } = opts;
  const stop = new AbortController();
  const signal = AbortSignal.any([io.signal, stop.signal]);
  const saver = createProjectSaver(project, projectPath, (err) => stop.abort(err));
  const progress = createProgress(io, settings);
  let usage: TokenUsage = { input: 0, output: 0 };

  let failure: unknown;
  try {
    await translateProject(project, provider, settings, {
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
  // Persist whatever finished, even after an abort or a fatal error, so the next run resumes from here.
  await saver.flush();

  const cost = usageCost(usage, settings.priceInPerM, settings.priceOutPerM);
  io.err(`Tokens used: ${formatTokens(usage.input)} in / ${formatTokens(usage.output)} out${cost === undefined ? '' : ` (${formatUsd(cost)})`}\n`);

  if (failure === undefined) return false;
  if (io.signal.aborted) {
    io.err(`Interrupted. Progress saved to ${projectPath}; re-run the same command to resume.\n`);
    return true;
  }
  throw failure;
}
