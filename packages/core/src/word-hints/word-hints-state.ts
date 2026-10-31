import type { ChatProvider, Project, ProjectSettings, WordHintEntry, WordHints } from '../types';
import type { FrequencyList, WordHintLanguage } from './frequency-list';
import { type GenerateWordHintsOptions, type GenerateWordHintsResult, generateWordHints } from './generate-word-hints';
import { glossLanguageOf, wordHintSettingsOf } from './hint-levels';
import { type HintCandidate, selectHintCandidates } from './select-hint-candidates';

/** What a "Generate hints" run will do for a book at its current settings. */
export interface WordHintsPlan {
  sourceLang: WordHintLanguage;
  glossLang: string;
  /** Candidates still without glosses (the run sends only these). */
  candidates: HintCandidate[];
  /** Every candidate at the current level, glossed or not. */
  total: number;
  /** True when the stored hints are for another language pair and will be replaced. */
  reset: boolean;
}

/**
 * Selects the candidates at the book's hint level and leaves out the lemmas already glossed for the same language
 * pair, which makes runs resumable and lets a higher level add only the new words. Stored hints for another pair
 * (the gloss or source language changed) are not reused.
 */
export function planWordHints(project: Project, list: FrequencyList, settings: ProjectSettings): WordHintsPlan {
  const glossLang = glossLanguageOf(settings);
  const all = selectHintCandidates(project, list, { level: wordHintSettingsOf(settings).level, glossary: settings.glossary });
  const stored = project.wordHints;
  const reset = stored !== undefined && (stored.sourceLang !== list.lang || stored.glossLang !== glossLang);
  const done = new Set(reset ? [] : (stored?.entries ?? []).map((e) => e.lemma));
  return { sourceLang: list.lang, glossLang, candidates: all.filter((c) => !done.has(c.lemma)), total: all.length, reset };
}

export interface GenerateProjectWordHintsOptions extends Omit<GenerateWordHintsOptions, 'sourceLang' | 'glossLang' | 'onEntry'> {
  /** The stored hints were replaced by an empty set for the plan's language pair (persist that before any entry). */
  onReset?: (hints: WordHints) => void;
  /** An entry was added to `project.wordHints` (persist it). */
  onEntry?: (entry: WordHintEntry) => void;
}

/**
 * Runs the plan and stores every finished lemma in `project.wordHints` as it arrives (callers persist it through
 * `onEntry`, so an interrupted run resumes where it stopped). Rejects on abort or a provider error.
 */
export async function generateProjectWordHints(
  project: Project,
  plan: WordHintsPlan,
  provider: ChatProvider,
  settings: Pick<ProjectSettings, 'concurrency'>,
  opts: GenerateProjectWordHintsOptions = {},
): Promise<GenerateWordHintsResult> {
  if (plan.reset || !project.wordHints) {
    project.wordHints = { sourceLang: plan.sourceLang, glossLang: plan.glossLang, entries: [] };
    opts.onReset?.(project.wordHints);
  }
  const hints = project.wordHints;
  const { onReset: _reset, onEntry, ...rest } = opts;
  return generateWordHints(plan.candidates, provider, settings, {
    ...rest,
    sourceLang: plan.sourceLang,
    glossLang: plan.glossLang,
    onEntry: (entry) => {
      const at = hints.entries.findIndex((e) => e.lemma === entry.lemma);
      if (at >= 0) hints.entries[at] = entry;
      else hints.entries.push(entry);
      project.updatedAt = new Date().toISOString();
      onEntry?.(entry);
    },
  });
}
