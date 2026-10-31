import { abortError, withRetry } from '../translate/retry-with-backoff';
import { concurrencyOf, runPool } from '../translate/translate-project';
import type { ChatProvider, ProjectSettings, TokenUsage, WordHintEntry, WordHintOccurrence, WordHintSense } from '../types';
import { buildGlossSystemPrompt, buildGlossUserMessage, type GlossAnswer, type GlossRequestItem, parseGlossAnswer } from './gloss-protocol';
import { type HintCandidate, hintContext } from './select-hint-candidates';

/** Items per gloss request. */
export const GLOSS_BATCH_SIZE = 40;
/** Contexts per lemma in the first round: the first occurrence and one from elsewhere in the book. */
export const SAMPLE_CONTEXTS = 2;
/** At most this many occurrences of a polysemous lemma are sent; the others take the sense of their nearest neighbour. */
export const MAX_CONTEXTS_PER_LEMMA = 12;
const MAX_OUTPUT_TOKENS = 4096;
/** Requests per batch whose answer cannot be parsed at all before its items count as failed. */
const PARSE_ATTEMPTS = 2;

export interface WordHintProgress {
  /** Lemmas finished (glossed, judged not worth a hint, or failed). */
  done: number;
  total: number;
  usage: TokenUsage;
}

export interface GenerateWordHintsOptions {
  sourceLang: string;
  glossLang: string;
  signal?: AbortSignal;
  onProgress?: (progress: WordHintProgress) => void;
  /** Called once per finished lemma, right away, so callers can persist it (resumable runs). */
  onEntry?: (entry: WordHintEntry) => void;
}

export interface GenerateWordHintsResult {
  /** Finished entries, in candidate order. */
  entries: WordHintEntry[];
  /** Lemmas whose glosses stayed unusable after a retry; a later run sends them again. */
  failed: number;
  usage: TokenUsage;
}

/** One request item: an occurrence of a candidate sent with its sentence. */
interface PlannedItem {
  item: GlossRequestItem;
  candidate: number;
  occurrence: number;
}

/** Indexes of the occurrences sent in the first round: the first one, and one from another chapter (else the middle one). */
export function sampleOccurrences(candidate: HintCandidate): number[] {
  const occ = candidate.occurrences;
  if (occ.length <= 1) return occ.length ? [0] : [];
  const first = occ[0]?.chapter;
  const other = occ.findIndex((o) => o.chapter !== first);
  return [0, other > 0 ? other : Math.floor(occ.length / 2)].slice(0, SAMPLE_CONTEXTS);
}

/** Up to `count` indexes spread evenly over `indexes`. */
function spread(indexes: number[], count: number): number[] {
  if (indexes.length <= count) return indexes;
  return Array.from({ length: count }, (_, i) => indexes[Math.floor((i * indexes.length) / count)] as number);
}

/** Packs items into batches of at most GLOSS_BATCH_SIZE, keeping the items of one lemma together. */
export function packBatches(groups: PlannedItem[][]): PlannedItem[][] {
  const batches: PlannedItem[][] = [];
  let current: PlannedItem[] = [];
  for (const group of groups) {
    if (current.length && current.length + group.length > GLOSS_BATCH_SIZE) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length) batches.push(current);
  return batches;
}

/** First-round items of every candidate, grouped per lemma. */
export function planFirstRound(candidates: readonly HintCandidate[]): PlannedItem[][] {
  let next = 0;
  return candidates.map((c, ci) =>
    sampleOccurrences(c).map((oi) => {
      const o = c.occurrences[oi] as HintCandidate['occurrences'][number];
      return { candidate: ci, occurrence: oi, item: { id: `w${next++}`, word: o.word, lemma: c.lemma, context: hintContext(o) } };
    }),
  );
}

/** A lemma whose sampled contexts showed several senses: its other occurrences are sent in a second round. */
interface Polysemous {
  candidate: number;
  senses: WordHintSense[];
  assigned: Map<number, string>;
}

/**
 * Writes Word Wise glosses for the candidates with the user's model. First round: up to two contexts per lemma.
 * A lemma whose contexts agree on one sense gets that gloss everywhere (most words); one with several senses gets a
 * second round in which its other occurrences (up to 12 in all) pick one of the known senses or a new one, so a gloss
 * is cached per lemma and sense. Requests run in parallel (`settings.concurrency`) with retry/backoff; an unparsable
 * answer is requested again once, glosses breaking the length caps are retried once, then the lemma counts as failed.
 * Provider errors and aborts reject; entries finished before that were already reported through `onEntry`.
 */
export async function generateWordHints(
  candidates: readonly HintCandidate[],
  provider: ChatProvider,
  settings: Pick<ProjectSettings, 'concurrency'>,
  opts: GenerateWordHintsOptions,
): Promise<GenerateWordHintsResult> {
  const system = buildGlossSystemPrompt(opts.sourceLang, opts.glossLang);
  const usage: TokenUsage = { input: 0, output: 0 };
  const entries = new Map<number, WordHintEntry>();
  const polysemous: Polysemous[] = [];
  let failed = 0;
  let done = 0;
  const report = () => opts.onProgress?.({ done, total: candidates.length, usage: { ...usage } });

  const controller = new AbortController();
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) throw abortError(opts.signal);
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const signal = controller.signal;

  /** One request (asked again once when the answer has no usable JSON); undefined when it stayed unusable. */
  const ask = async (items: GlossRequestItem[]): Promise<Map<string, GlossAnswer> | undefined> => {
    const requested = new Set(items.map((i) => i.id));
    for (let attempt = 1; ; attempt++) {
      const res = await withRetry(() => provider.chat({ system, user: buildGlossUserMessage(items), maxTokens: MAX_OUTPUT_TOKENS, signal }), signal);
      if (res.usage) {
        usage.input += res.usage.input;
        usage.output += res.usage.output;
      }
      try {
        return parseGlossAnswer(res.text, requested);
      } catch {
        if (attempt >= PARSE_ATTEMPTS) return undefined;
      }
    }
  };
  /** Sends a batch; items missing from a parsed answer or with unusable glosses are sent once more on their own. */
  const answer = async (batch: PlannedItem[]): Promise<Map<string, GlossAnswer>> => {
    const answers = await ask(batch.map((p) => p.item));
    if (!answers) return new Map();
    const missing = batch.filter((p) => !answers.has(p.item.id)).map((p) => p.item);
    if (missing.length) for (const [id, a] of (await ask(missing)) ?? []) answers.set(id, a);
    return answers;
  };

  const finish = (index: number, entry: WordHintEntry | undefined) => {
    if (entry) {
      entries.set(index, entry);
      opts.onEntry?.(entry);
    } else failed++;
    done++;
    report();
  };
  const entryOf = (index: number, senses: WordHintSense[], senseAt: (occurrence: number) => string | undefined): WordHintEntry => {
    const c = candidates[index] as HintCandidate;
    const occurrences: WordHintOccurrence[] = [];
    c.occurrences.forEach((o, i) => {
      const sense = senseAt(i);
      if (sense) occurrences.push({ segmentId: o.segmentId, word: o.word, nth: o.nth, sense });
    });
    return { lemma: c.lemma, rank: c.rank, senses, occurrences };
  };

  const firstRound = async (batch: PlannedItem[]) => {
    const answers = await answer(batch);
    const byCandidate = new Map<number, PlannedItem[]>();
    for (const p of batch) byCandidate.set(p.candidate, [...(byCandidate.get(p.candidate) ?? []), p]);
    for (const [index, items] of byCandidate) {
      const results = items.map((p) => answers.get(p.item.id));
      if (results.some((r) => r === undefined)) {
        finish(index, undefined);
        continue;
      }
      const senses: WordHintSense[] = [];
      const assigned = new Map<number, string>();
      items.forEach((p, i) => {
        const r = results[i] as GlossAnswer;
        if (r.skip) return;
        if (!senses.some((s) => s.id === r.sense)) senses.push({ id: r.sense, gloss: r.gloss });
        assigned.set(p.occurrence, r.sense);
      });
      if (senses.length === 0)
        finish(
          index,
          entryOf(index, [], () => undefined),
        );
      else if (senses.length === 1)
        finish(
          index,
          entryOf(index, senses, () => senses[0]?.id),
        );
      else polysemous.push({ candidate: index, senses, assigned });
    }
  };

  const secondRound = async (batch: PlannedItem[]) => {
    const answers = await answer(batch);
    const lemmas = new Set(batch.map((p) => p.candidate));
    for (const lemma of polysemous.filter((p) => lemmas.has(p.candidate))) {
      for (const p of batch.filter((b) => b.candidate === lemma.candidate)) {
        const r = answers.get(p.item.id);
        if (!r || r.skip) continue;
        if (!lemma.senses.some((s) => s.id === r.sense)) lemma.senses.push({ id: r.sense, gloss: r.gloss });
        lemma.assigned.set(p.occurrence, r.sense);
      }
      finish(
        lemma.candidate,
        entryOf(lemma.candidate, lemma.senses, (i) => nearestSense(lemma.assigned, i) ?? lemma.senses[0]?.id),
      );
    }
  };

  try {
    report();
    await runPool(packBatches(planFirstRound(candidates)), concurrencyOf(settings), firstRound, controller);
    let next = 0;
    const groups = polysemous.map((lemma) => {
      const c = candidates[lemma.candidate] as HintCandidate;
      const rest = c.occurrences.map((_, i) => i).filter((i) => !lemma.assigned.has(i));
      return spread(rest, Math.max(0, MAX_CONTEXTS_PER_LEMMA - lemma.assigned.size)).map((oi) => {
        const o = c.occurrences[oi] as HintCandidate['occurrences'][number];
        const item: GlossRequestItem = { id: `p${next++}`, word: o.word, lemma: c.lemma, context: hintContext(o), senses: lemma.senses };
        return { candidate: lemma.candidate, occurrence: oi, item };
      });
    });
    // A polysemous lemma whose occurrences were all sampled already has every sense it needs.
    for (const lemma of polysemous.filter((_, i) => groups[i]?.length === 0)) {
      finish(
        lemma.candidate,
        entryOf(lemma.candidate, lemma.senses, (i) => nearestSense(lemma.assigned, i) ?? lemma.senses[0]?.id),
      );
    }
    await runPool(packBatches(groups.filter((g) => g.length > 0)), concurrencyOf(settings), secondRound, controller);
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
  return { entries: [...entries.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e), failed, usage };
}

/** Sense of the nearest occurrence (in book order) whose sense the model chose, preferring the previous one. */
function nearestSense(assigned: Map<number, string>, index: number): string | undefined {
  if (assigned.has(index)) return assigned.get(index);
  let best: number | undefined;
  for (const i of assigned.keys()) {
    if (best === undefined || Math.abs(i - index) < Math.abs(best - index) || (Math.abs(i - index) === Math.abs(best - index) && i < best)) best = i;
  }
  return best === undefined ? undefined : assigned.get(best);
}
