import {
  estimateWordHintsCost,
  generateProjectWordHints,
  glossLanguageOf,
  HINT_LEVEL_CEFR,
  type ProjectSettings,
  planWordHints,
  type TokenUsage,
  WORD_HINT_LANGUAGES,
  type WordHintsPlan,
  wordHintLanguage,
  wordHintSettingsOf,
} from '@epubtrans/core';
import { expectPositionals, parseArgs, UsageError } from '../args';
import { HINTS_FLAGS } from '../flag-specs';
import { applyHintsCommandFlags } from '../hint-flags';
import type { Io } from '../io';
import { confirmRun, EXIT } from '../pipeline';
import { lookupEstimatePrices } from '../price-lookup';
import { createProgress, formatTokens, formatUsd, usageCost } from '../progress';
import { createProjectSaver, writeProjectFile } from '../project-store';
import { applyRunFlags, selectProvider } from '../settings';
import { applyStyleFlags } from '../style-flags';
import { loadFrequencyList } from '../word-frequency';
import { openProject } from './open-project';
import { buildProvider } from './provider-setup';

const USAGE =
  'epubtrans hints <input.(epub|mobi|azw3|fb2) | project.epubtrans> [--level N] [--gloss-lang <lang>] [--style ruby|inline] [--style-file style.json] --model <id> [options]';

function describeEstimate(plan: WordHintsPlan, settings: ProjectSettings): string {
  const hints = wordHintSettingsOf(settings);
  const estimate = estimateWordHintsCost(plan.candidates, settings, plan);
  const cost =
    estimate.usd !== undefined ? `about ${formatUsd(estimate.usd)}` : 'cost unknown (pass --price-in and --price-out, USD per 1M tokens, for a cost estimate)';
  return [
    `Word Wise hints: level ${hints.level} (about ${HINT_LEVEL_CEFR[hints.level]} readers), glosses in ${plan.glossLang}`,
    `Words to gloss: ${estimate.words} (${estimate.occurrences} occurrences; ${plan.total - plan.candidates.length} of ${plan.total} already glossed)${plan.reset ? '; the stored hints of another language pair are replaced' : ''}`,
    `Model: ${settings.model} via ${settings.baseURL}`,
    `Estimated usage: ~${formatTokens(estimate.inputTokens)} input / ~${formatTokens(estimate.outputTokens)} output tokens in about ${estimate.requests}+ requests, ${cost}`,
  ].join('\n');
}

/**
 * Generates Word Wise glosses for the difficult words of the original text and saves them in the project file
 * (created next to the book if missing). Only words without a gloss are sent, so running it again resumes, and a
 * higher --level adds only the new words. Exporting with hints is a separate step (`export --word-wise`).
 */
export async function hintsCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, flags } = parseArgs(argv, HINTS_FLAGS);
  const [input] = expectPositionals(positionals, 1, USAGE) as [string];
  // A book that is only read with hints needs no translation: the gloss language can stand in for --to.
  const opened = await openProject(input, { project: flags.project, to: flags.to, from: flags.from, defaultTo: flags['gloss-lang'] }, io, USAGE);
  const { project, projectPath } = opened;

  const selection = selectProvider(flags, opened.existing ? project.settings : undefined);
  const settings = await applyStyleFlags(applyHintsCommandFlags(applyRunFlags(opened.settings, flags, selection), flags), flags, io);
  if (!settings.model) throw new UsageError('--model <id> is required. List the available models with: epubtrans models --provider <id>');
  const lang = wordHintLanguage(settings.sourceLang);
  if (!lang) {
    throw new UsageError(
      `Word Wise hints need a supported source language (${WORD_HINT_LANGUAGES.join(', ')}); this book's is "${settings.sourceLang}". Pass --from <lang> if it is wrong.`,
    );
  }
  const chat = await buildProvider(selection, flags['api-key-file'], settings.model, io);

  project.settings = settings;
  await writeProjectFile(project, projectPath);
  const plan = planWordHints(project, await loadFrequencyList(lang), settings);
  if (plan.candidates.length === 0) {
    io.err(`All ${plan.total} words at level ${wordHintSettingsOf(settings).level} already have glosses in ${glossLanguageOf(settings)}. Nothing to do.\n`);
    return EXIT.ok;
  }
  const looked = await lookupEstimatePrices(settings, io, flags['no-price-lookup'] !== true);
  const priced = { ...settings, ...looked };
  io.err(`${describeEstimate(plan, priced)}\n`);
  if (!(await confirmRun(io, flags.yes === true))) {
    io.err(`Cancelled. Project saved to ${projectPath}; no request was made.\n`);
    return EXIT.failure;
  }

  const stop = new AbortController();
  const signal = AbortSignal.any([io.signal, stop.signal]);
  const saver = createProjectSaver(project, projectPath, (err) => stop.abort(err));
  const progress = createProgress(io, priced);
  let usage: TokenUsage = { input: 0, output: 0 };
  let failure: unknown;
  let failed = 0;
  try {
    const result = await generateProjectWordHints(project, plan, chat, settings, {
      signal,
      onReset: () => saver.markDirty(),
      onEntry: () => saver.markDirty(),
      onProgress: (p) => {
        usage = p.usage;
        progress.update({ phase: 'hints', ...p });
      },
    });
    failed = result.failed;
  } catch (err) {
    failure = err;
  }
  progress.finish();
  // Persist every finished word, even after an abort or a fatal error, so the next run resumes from here.
  await saver.flush();

  const cost = usageCost(usage, priced.priceInPerM, priced.priceOutPerM);
  io.err(`Tokens used: ${formatTokens(usage.input)} in / ${formatTokens(usage.output)} out${cost === undefined ? '' : ` (${formatUsd(cost)})`}\n`);
  if (failure !== undefined) {
    if (!io.signal.aborted) throw failure;
    io.err(`Interrupted. Glossed words are saved to ${projectPath}; run the same command to continue.\n`);
    return EXIT.interrupted;
  }
  const glossed = project.wordHints?.entries.length ?? 0;
  io.err(
    `Saved ${glossed} glossed words to ${projectPath}. Export with hints: epubtrans export ${projectPath} --mode original --word-wise ` +
      `(or a bilingual --mode after translating).\n`,
  );
  if (failed > 0) {
    io.err(`${failed} words could not be glossed (unusable model answers); run the same command to retry them.\n`);
    return EXIT.incomplete;
  }
  return EXIT.ok;
}
