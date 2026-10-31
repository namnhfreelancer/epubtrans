import type { ChatProvider, Project, ProjectSettings, WordHintEntry, WordHints } from '../types';
import type { FrequencyList, WordHintLanguage } from './frequency-list';
import { type GenerateWordHintsOptions, type GenerateWordHintsResult, generateWordHints } from './generate-word-hints';
import { glossLanguageOf, wordHintSettingsOf } from './hint-levels';
import { type HintCandidate, selectHintCandidates } from './select-hint-candidates';

/** What a "Generate hints" run will do for a book at its current settings. */
export interface WordHintsPlan {
  sourceLang: WordHintLanguage;
  glossLang: string;
  /** Candidates still without glosses, or with some occurrences still without one (the run sends only these). */
  candidates: HintCandidate[];
  /** Every candidate at the current level, glossed or not. */
  total: number;
  /** True when the stored hints are for another language pair and will be replaced. */
  reset: boolean;
}

const occurrenceKey = (o: { segmentId: string; word: string; nth: number }) => `${o.segmentId}\u0000${o.word}\u0000${o.nth}`;

/**
 * Selects the candidates at the book's hint level and leaves out what is already glossed for the same language pair,
 * occurrence by occurrence: a new lemma is sent whole; a glossed lemma with occurrences its entry lacks is sent with
 * only those, together with its known senses; a lemma the model judged not worth a hint is not sent again. Since a
 * candidate carries every form of its lemma, a higher level adds only new lemmas and a lower one needs no request.
 * Runs are resumable. Stored hints for another pair (the gloss or source language changed) are not reused.
 */
export function planWordHints(project: Project, list: FrequencyList, settings: ProjectSettings): WordHintsPlan {
  const glossLang = glossLanguageOf(settings);
  const all = selectHintCandidates(project, list, { level: wordHintSettingsOf(settings).level, glossary: settings.glossary });
  const stored = project.wordHints;
  const reset = stored !== undefined && (stored.sourceLang !== list.lang || stored.glossLang !== glossLang);
  const done = new Map((reset ? [] : (stored?.entries ?? [])).map((e) => [e.lemma, e]));
  const candidates: HintCandidate[] = [];
  for (const c of all) {
    const entry = done.get(c.lemma);
    if (!entry) {
      candidates.push(c);
      continue;
    }
    if (entry.senses.length === 0) continue;
    const have = new Set(entry.occurrences.map(occurrenceKey));
    const missing = c.occurrences.filter((o) => !have.has(occurrenceKey(o)));
    if (missing.length) candidates.push({ ...c, occurrences: missing, senses: entry.senses });
  }
  return { sourceLang: list.lang, glossLang, candidates, total: all.length, reset };
}

/** `entry` merged into the stored entry of its lemma: known senses and occurrences stay, new ones are added. */
function mergeEntry(stored: WordHintEntry | undefined, entry: WordHintEntry): WordHintEntry {
  if (!stored || stored.senses.length === 0) return entry;
  const senses = [...stored.senses, ...entry.senses.filter((s) => !stored.senses.some((k) => k.id === s.id))];
  const have = new Set(stored.occurrences.map(occurrenceKey));
  const occurrences = [...stored.occurrences, ...entry.occurrences.filter((o) => !have.has(occurrenceKey(o)))];
  return { lemma: entry.lemma, rank: Math.max(stored.rank, entry.rank), senses, occurrences };
}

export interface GenerateProjectWordHintsOptions extends Omit<GenerateWordHintsOptions, 'sourceLang' | 'glossLang' | 'onEntry'> {
  /** The stored hints were replaced by an empty set for the plan's language pair (persist that before any entry). */
  onReset?: (hints: WordHints) => void;
  /** An entry was added to `project.wordHints` (persist it). */
  onEntry?: (entry: WordHintEntry) => void;
}

/**
 * Runs the plan and stores every finished lemma in `project.wordHints` as it arrives, merged with what the lemma
 * already had (callers persist the merged entry through `onEntry`, so an interrupted run resumes where it stopped).
 * Rejects on abort or a provider error.
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
    onEntry: (finished) => {
      const at = hints.entries.findIndex((e) => e.lemma === finished.lemma);
      const entry = mergeEntry(at >= 0 ? hints.entries[at] : undefined, finished);
      if (at >= 0) hints.entries[at] = entry;
      else hints.entries.push(entry);
      project.updatedAt = new Date().toISOString();
      onEntry?.(entry);
    },
  });
}
