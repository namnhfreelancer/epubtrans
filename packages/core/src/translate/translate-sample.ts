import { TOC_CHAPTER_TITLE } from '../import/import-book';
import type { Chapter, ChatProvider, CostEstimate, Project, ProjectSettings, SamplePassage, SampleSelection, Segment, TranslateOptions } from '../types';
import { estimateCost } from './estimate-cost';
import { keepsUserEdit, translateProject } from './translate-project';

export const DEFAULT_SAMPLE_PASSAGES = 5;
export const DEFAULT_SAMPLE_WORDS = 350;
export const MAX_SAMPLE_PASSAGES = 50;
const MIN_SAMPLE_WORDS = 20;
const MAX_SAMPLE_WORDS = 5000;
/** Chapters with less text than this (dedications, epigraphs, half-title pages) make poor samples. */
const MIN_CHAPTER_WORDS = 100;
const MAX_SEED = 0xffffffff;
/**
 * Titles of back matter that says little about translation quality (index, notes, bibliography, credits).
 * Matched against the whole title, case-insensitively, ignoring trailing punctuation.
 */
const BACK_MATTER_TITLE =
  /^(?:index(?: of .*)?|general index|notes?(?: (?:to|on) .*)?|end ?notes|footnotes|bibliography|select(?:ed)? bibliography|references|works cited|sources|further reading|acknowledge?ments?|copyright(?: page)?|credits|permissions|about the authors?|also by .*|colophon|register|anmerkungen|literaturverzeichnis|danksagung|bibliographie|remerciements|notas|bibliografía|índice alfabético|agradecimientos|примечания|указатель|библиография|список литературы|chú thích|ghi chú|tài liệu tham khảo|lời cảm ơn|mục từ)$/i;
export const isBackMatterTitle = (title: string): boolean => BACK_MATTER_TITLE.test(title.trim().replace(/[\s.:;,!]+$/u, ''));

export interface SampleSelectionOptions {
  /** Number of passages, each from a different chapter (default 5). Fewer are returned when the book has fewer usable chapters. */
  passages?: number;
  /** Source words per passage (default 350); a passage ends at the first segment that reaches the budget. */
  wordsPerPassage?: number;
  /** Seed of the pseudo-random generator (default: a fresh random seed). */
  seed?: number;
}

export interface TranslateSampleOptions extends SampleSelectionOptions, Omit<TranslateOptions, 'overwriteUserEdited'> {
  /** Translate exactly these passages (for example the stored `project.lastSample`) instead of picking new ones. */
  selection?: SampleSelection;
  /** Called once the passages are known and stored in `project.lastSample`, before any request is made. */
  onSelect?: (selection: SampleSelection) => void;
}

/** Fresh random seed for a "new random samples" request. */
export function randomSampleSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/** mulberry32: a small deterministic generator, so a seed always yields the same passages. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

/** Whitespace-separated words; CJK text has no spaces, so two characters count as one word. */
function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.replace(CJK, ' ').split(/\s+/).filter(Boolean).length;
  return latin + cjk / 2;
}

function requireInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

/**
 * Picks the passages for a sample translation. The usable chapters (not the table of contents or back matter such as
 * the index, notes or bibliography, enough text)
 * are cut into `passages` equal groups in book order and one chapter is drawn from each group, which spreads
 * the sample across the book. Inside a chapter the passage is a contiguous run of segments that starts at a
 * random position and ends at the first segment that reaches the word budget.
 * Pure and deterministic: the same book, options and seed always give the same selection.
 */
export function selectSamplePassages(project: Project, opts: SampleSelectionOptions = {}): SampleSelection {
  const passages = requireInteger('passages', opts.passages ?? DEFAULT_SAMPLE_PASSAGES, 1, MAX_SAMPLE_PASSAGES);
  const budget = requireInteger('wordsPerPassage', opts.wordsPerPassage ?? DEFAULT_SAMPLE_WORDS, MIN_SAMPLE_WORDS, MAX_SAMPLE_WORDS);
  const seed = requireInteger('seed', opts.seed ?? randomSampleSeed(), 0, MAX_SEED);

  const measured = project.chapters
    .filter((c) => c.title !== TOC_CHAPTER_TITLE && c.segments.length > 0)
    .map((chapter) => ({ chapter, words: chapter.segments.map((s) => countWords(s.sourceText)) }))
    .map((m) => ({ ...m, total: m.words.reduce((a, b) => a + b, 0) }));
  const substantial = measured.filter((m) => m.total >= MIN_CHAPTER_WORDS);
  const body = substantial.filter((m) => !isBackMatterTitle(m.chapter.title));
  // A very short book may have no substantial chapter; sample whatever text there is rather than nothing.
  const pool = body.length > 0 ? body : substantial.length > 0 ? substantial : measured.filter((m) => m.total > 0);
  if (pool.length === 0) throw new Error('The book has no text to sample');

  const random = createRandom(seed);
  const count = Math.min(passages, pool.length);
  const picked: SamplePassage[] = [];
  for (let i = 0; i < count; i++) {
    const lo = Math.floor((i * pool.length) / count);
    const hi = Math.floor(((i + 1) * pool.length) / count);
    const { chapter, words, total } = pool[lo + Math.floor(random() * (hi - lo))] as (typeof pool)[number];
    picked.push(pickRun(chapter, words, total, budget, random));
  }
  return { seed, passages: picked };
}

function pickRun(chapter: Chapter, words: number[], total: number, budget: number, random: () => number): SamplePassage {
  // Only starts with at least `budget` words left produce a full passage; a shorter chapter is taken whole.
  let start = 0;
  if (total > budget) {
    let remaining = total;
    let lastStart = 0;
    for (let i = 0; i < words.length && remaining >= budget; i++) {
      lastStart = i;
      remaining -= words[i] as number;
    }
    start = Math.floor(random() * (lastStart + 1));
  }
  const ids: string[] = [];
  let sum = 0;
  for (let i = start; i < chapter.segments.length && sum < budget; i++) {
    ids.push((chapter.segments[i] as Segment).id);
    sum += words[i] as number;
  }
  return { chapterHref: chapter.href, chapterTitle: chapter.title, segmentIds: ids };
}

/** Keeps the passages whose segments still exist in the project (a stored selection may be stale). */
function resolveSelection(project: Project, selection: SampleSelection): SampleSelection {
  const known = new Set(project.chapters.flatMap((c) => c.segments.map((s) => s.id)));
  const passages = selection.passages.map((p) => ({ ...p, segmentIds: p.segmentIds.filter((id) => known.has(id)) })).filter((p) => p.segmentIds.length > 0);
  if (passages.length === 0) throw new Error('The stored sample no longer matches this book');
  return { seed: selection.seed, passages };
}

export interface SampleRunResult {
  /** The passages that were sampled (also stored in `project.lastSample`). */
  selection: SampleSelection;
  /**
   * Ids of sampled segments whose sample translation failed. A segment that already had a translation keeps it and
   * its status; only a segment without one is marked as 'error'.
   */
  failed: string[];
  /** Ids of sampled segments skipped because the user edited their translation by hand (`userEdited`). */
  keptEdited: string[];
}

/**
 * Pending copies of the sampled segments, grouped in their chapters, plus the live segment behind each copy.
 * Segments the user edited by hand are not copied (a sample never overwrites them) and are listed in `keptEdited`.
 */
function sampleView(
  project: Project,
  selection: SampleSelection,
): { view: Project; live: Map<string, { segment: Segment; chapter: Chapter }>; keptEdited: string[] } {
  const wanted = new Set(selection.passages.flatMap((p) => p.segmentIds));
  const live = new Map<string, { segment: Segment; chapter: Chapter }>();
  const keptEdited: string[] = [];
  const chapters: Chapter[] = [];
  for (const chapter of project.chapters) {
    const copies: Segment[] = [];
    for (const segment of chapter.segments) {
      if (!wanted.has(segment.id)) continue;
      if (keepsUserEdit(segment)) {
        keptEdited.push(segment.id);
        continue;
      }
      live.set(segment.id, { segment, chapter });
      copies.push({ id: segment.id, sourceHtml: segment.sourceHtml, sourceText: segment.sourceText, status: 'pending' });
    }
    if (copies.length) chapters.push({ href: chapter.href, title: chapter.title, segments: copies });
  }
  return { view: { ...project, chapters }, live, keptEdited };
}

/**
 * Token and cost estimate for translating (again) exactly the sampled segments, whatever their current status,
 * except those the user edited by hand (a sample skips them).
 */
export function estimateSampleCost(project: Project, settings: ProjectSettings, selection: SampleSelection): CostEstimate {
  return estimateCost(sampleView(project, selection).view, settings);
}

/** What a user edit changes; compared against the state when the sample run started. */
const revisionOf = (s: Segment) => `${s.status}\u0000${s.userEdited === true}\u0000${s.translationHtml ?? ''}`;

/**
 * Translates a few passages from different parts of the book with the normal engine (same guideline,
 * glossary, validation and retries) so the user can judge the quality before the full run.
 * The sampled segments are always translated again, even when already translated, which makes
 * "translate samples again" after a guideline edit work; afterwards they count as translated and a full
 * `translateProject` skips them. The picked passages are stored in `project.lastSample`.
 * Never loses work: segments the user edited by hand are skipped, a failed sample translation leaves a segment
 * that already had a translation unchanged (only reported in `failed`), and a live segment the user changed during
 * the run is left alone. Rejects on abort or a fatal provider error.
 */
export async function translateSample(
  project: Project,
  provider: ChatProvider,
  settings: ProjectSettings,
  opts: TranslateSampleOptions = {},
): Promise<SampleRunResult> {
  const selection = opts.selection
    ? resolveSelection(project, opts.selection)
    : selectSamplePassages(project, {
        ...(opts.passages !== undefined ? { passages: opts.passages } : {}),
        ...(opts.wordsPerPassage !== undefined ? { wordsPerPassage: opts.wordsPerPassage } : {}),
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      });
  project.lastSample = selection;
  opts.onSelect?.(selection);

  const { view, live, keptEdited } = sampleView(project, selection);
  const failed = new Set<string>();
  // Revision of each live segment as this run last left it; a different one means the user changed it meanwhile.
  const expected = new Map([...live].map(([id, { segment }]) => [id, revisionOf(segment)]));
  await translateProject(view, provider, settings, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    onSegment: (copy) => {
      const target = live.get(copy.id);
      if (!target || expected.get(copy.id) !== revisionOf(target.segment)) return;
      if (copy.status === 'error') {
        failed.add(copy.id);
        // An existing translation (possibly reviewed or exported already) beats a failed retry: keep it untouched.
        if (target.segment.translationHtml !== undefined) return;
      }
      target.segment.status = copy.status;
      if (copy.translationHtml !== undefined) target.segment.translationHtml = copy.translationHtml;
      if (copy.error !== undefined) target.segment.error = copy.error;
      else delete target.segment.error;
      if (copy.warning !== undefined) target.segment.warning = copy.warning;
      else delete target.segment.warning;
      expected.set(copy.id, revisionOf(target.segment));
      project.updatedAt = new Date().toISOString();
      opts.onSegment?.(target.segment, target.chapter);
    },
  });
  return { selection, failed: [...failed], keptEdited };
}
