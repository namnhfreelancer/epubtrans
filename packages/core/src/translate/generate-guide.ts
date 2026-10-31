import { classifyCandidates } from '../glossary/classify-candidates';
import { extractGlossaryCandidates, type GlossaryCandidate } from '../glossary/extract-candidates';
import { glossaryLimit, mergeGlossary } from '../glossary/merge-glossary';
import type { ChatProvider, GlossaryEntry, Project, ProjectSettings } from '../types';
import { buildGuidelineSystemPrompt, composeGuideline, parseGuidelineAnswer, splitGuideline } from './generate-guide-guideline';
import { contentChapters, sampleBookPassages } from './generate-guide-passages';
import { abortError, withRetry } from './retry-with-backoff';
import { estimateTokens } from './token-estimate';

export type GuidePhase = 'extract' | 'guideline' | 'glossary';

export interface GuideProgress {
  phase: GuidePhase;
  /** Units done in this phase: 0/1 for `extract` and `guideline`, candidates classified for `glossary`. */
  done: number;
  total: number;
}

export interface GenerateGuideOptions {
  signal?: AbortSignal;
  onProgress?: (progress: GuideProgress) => void;
  /** Upper bound of glossary entries (default 400); the actual limit also scales with book length, see `glossaryLimit`. */
  maxEntries?: number;
}

export interface GeneratedGuide {
  guideline: string;
  glossary: GlossaryEntry[];
  /** Candidates found locally and sent for classification. */
  candidates: number;
  /** Classification batches skipped because the model answer was unusable or the request kept failing. */
  skippedBatches: number;
}

/** Candidates sent to the model per glossary slot: many candidates are dropped as non-terms. */
const CANDIDATES_PER_ENTRY = 2;
const MAX_TITLES = 60;
const MAX_NAMES = 40;
const CAPITALIZED = /^\p{Lu}/u;

/**
 * Drafts a book-specific style guideline and glossary in three phases:
 * 1. `extract`: local candidate extraction over the whole book (no model call);
 * 2. `guideline`: one request with ~18 passages spread over the book, answered in fixed sections;
 *    the result extends the current guideline (see `splitGuideline`) instead of replacing it;
 * 3. `glossary`: candidates are classified and translated in batches (using the new guideline), then merged
 *    into the existing glossary, which is kept as is, up to `glossaryLimit(bookTokens, maxEntries)` entries.
 * Rejects on abort or provider error; the project and settings are not modified.
 */
export async function generateGuide(
  project: Project,
  provider: ChatProvider,
  settings: ProjectSettings,
  opts: GenerateGuideOptions = {},
): Promise<GeneratedGuide> {
  const { signal, onProgress } = opts;
  const checkAbort = () => {
    if (signal?.aborted) throw abortError(signal);
  };
  checkAbort();
  onProgress?.({ phase: 'extract', done: 0, total: 1 });
  // Let the caller render the first progress state before the synchronous scan.
  await new Promise((resolve) => setTimeout(resolve, 0));
  checkAbort();
  const chapters = contentChapters(project);
  const paragraphs = chapters.flatMap((c) => c.segments.map((s) => s.sourceText));
  const limit = glossaryLimit(
    paragraphs.reduce((n, p) => n + estimateTokens(p), 0),
    opts.maxEntries,
  );
  const candidates = extractGlossaryCandidates(paragraphs, { maxCandidates: limit * CANDIDATES_PER_ENTRY });
  onProgress?.({ phase: 'extract', done: 1, total: 1 });

  onProgress?.({ phase: 'guideline', done: 0, total: 1 });
  const { base } = splitGuideline(settings.guideline);
  const user = buildGuidelineUserMessage(project, candidates);
  const res = await withRetry(() => provider.chat({ system: buildGuidelineSystemPrompt(settings, base), user, maxTokens: 4096, signal }), signal);
  const guideline = composeGuideline(base, parseGuidelineAnswer(res.text));
  onProgress?.({ phase: 'guideline', done: 1, total: 1 });

  const { entries, skippedBatches } = await classifyCandidates(
    candidates,
    provider,
    { ...settings, guideline },
    {
      ...(signal ? { signal } : {}),
      concurrency: settings.concurrency,
      bookTitle: project.title,
      onProgress: (done, total) => onProgress?.({ phase: 'glossary', done, total }),
    },
  );
  return { guideline, glossary: mergeGlossary(settings.glossary, entries, limit), candidates: candidates.length, skippedBatches };
}

/** Book title, chapter titles, frequent names (for forms of address) and the sampled passages, as plain text. */
export function buildGuidelineUserMessage(project: Project, candidates: readonly GlossaryCandidate[]): string {
  const chapters = contentChapters(project)
    .map((c) => c.title.trim())
    .filter(Boolean);
  const titles = chapters.slice(0, MAX_TITLES).join(' | ') + (chapters.length > MAX_TITLES ? ` | … (${chapters.length} chapters)` : '');
  const names = candidates
    .filter((c) => CAPITALIZED.test(c.term))
    .slice(0, MAX_NAMES)
    .map((c) => `${c.term} (${c.count})`)
    .join(', ');
  const passages = sampleBookPassages(project)
    .map((p, i) => `### Passage ${i + 1}${p.chapter ? ` (${p.chapter})` : ''}\n${p.text}`)
    .join('\n\n');
  return [
    `Book: ${project.title}${project.author ? ` by ${project.author}` : ''}`,
    `Chapter titles: ${titles || '(none)'}`,
    `Frequent names (occurrences): ${names || '(none found)'}`,
    `Passages:\n\n${passages}`,
  ].join('\n\n');
}
