import {
  type ChatProvider,
  type ExportMode,
  estimateCost,
  exportEpub,
  type Project,
  type ProjectSettings,
  type TokenUsage,
  translateProject,
} from '@epubtrans/core';
import { UsageError } from './args';
import { domEnv } from './dom-env';
import type { Io } from './io';
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
  yes: boolean;
  io: Io;
}

/** OpenRouter publishes per-model prices; use them when the user did not pass `--price-in/--price-out`. */
async function prefillPrices(settings: ProjectSettings, provider: ChatProvider, io: Io): Promise<ProjectSettings> {
  if (settings.providerId !== 'openrouter' || !provider.listModelInfo) return settings;
  if (settings.priceInPerM !== undefined || settings.priceOutPerM !== undefined) return settings;
  try {
    const info = (await provider.listModelInfo(io.signal)).find((m) => m.id === settings.model);
    if (info?.priceInPerM === undefined || info.priceOutPerM === undefined) return settings;
    io.err(`Prices from OpenRouter: $${info.priceInPerM}/M input, $${info.priceOutPerM}/M output\n`);
    return { ...settings, priceInPerM: info.priceInPerM, priceOutPerM: info.priceOutPerM };
  } catch {
    return settings; // prices are optional; a failing /models call must not block translating
  }
}

async function confirmRun(io: Io, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!io.interactive) throw new UsageError('Not running in a terminal: pass --yes to start without confirmation.');
  return /^y(es)?$/i.test((await io.prompt('Proceed? [y/N] ')).trim());
}

function describeEstimate(project: Project, settings: ProjectSettings, todo: number): string {
  const estimate = estimateCost(project, settings);
  const cost =
    estimate.usd !== undefined ? `about ${formatUsd(estimate.usd)}` : 'cost unknown (pass --price-in and --price-out, USD per 1M tokens, for a cost estimate)';
  return [
    `Segments to translate: ${todo}${settings.twoPass ? ' (+ review pass)' : ''}`,
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
  const settings = await prefillPrices(opts.settings, provider, io);
  project.settings = settings;
  await writeProjectFile(project, projectPath);

  const before = countStatuses(project);
  const todo = before.pending + before.error;
  if (todo > 0) {
    io.err(`${describeEstimate(project, settings, todo)}\n`);
    if (!(await confirmRun(io, opts.yes))) {
      io.err(`Cancelled. Project saved to ${projectPath}; nothing was sent to the provider.\n`);
      return EXIT.failure;
    }
    const interrupted = await runTranslation(opts, settings);
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
