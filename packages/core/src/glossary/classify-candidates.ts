import { ProviderError } from '../providers/provider-http';
import { buildContextBlock, extractJson } from '../translate/prompt-protocol';
import { abortError, withRetry } from '../translate/retry-with-backoff';
import type { ChatProvider, GlossaryEntry, ProjectSettings } from '../types';
import type { GlossaryCandidate } from './extract-candidates';
import { foldGlossaryKey, isGlossaryTermType } from './glossary-entry';

/** Candidates per classification request. */
export const CLASSIFY_BATCH_SIZE = 80;
const MAX_OUTPUT_TOKENS = 4096;
/** Requests per batch whose answer cannot be parsed before the batch is skipped. */
const PARSE_ATTEMPTS = 2;

export interface ClassifyOptions {
  signal?: AbortSignal;
  /** Parallel requests (clamped to 1–16). */
  concurrency?: number;
  bookTitle?: string;
  /** Candidates classified so far (finished batches), out of all candidates. */
  onProgress?: (done: number, total: number) => void;
}

export interface ClassifyResult {
  entries: GlossaryEntry[];
  /** Batches dropped because the model kept answering with unusable JSON. */
  skippedBatches: number;
}

/** Stable across batches (cacheable): role, language pair, guideline (names policy), task and answer format. */
export function buildClassifySystemPrompt(settings: ProjectSettings): string {
  return `You are a terminology editor building the glossary for a book translation. You receive glossary candidates that were extracted automatically from the book; many of them are ordinary words or phrases and must be dropped.

${buildContextBlock(settings)}

## Task
- Input: a list of candidates, each with its frequency in the book and up to two context snippets.
- Keep only terms that must be translated consistently across the book: names of people and characters, places, organizations, and recurring domain terms, concepts, titles or invented words. Drop everything else (common words, ordinary phrases, sentence fragments, names of the e-book distributor such as Project Gutenberg).
- For every kept term give its target-language translation, following the style guideline (especially its names policy), and its type: "person", "place", "organization", "term" or "other".
- Add a short "note" (at most 12 words) only when it helps consistency, for example gender, role and relationships of a person (needed to choose pronouns and forms of address), or the sense in which a term is used.
- "term" must be copied exactly from the input.
- Answer with JSON only, no markdown fences: {"entries":[{"term":"…","translation":"…","type":"person","note":"…"}]}`;
}

export function buildClassifyUserMessage(candidates: readonly GlossaryCandidate[], bookTitle?: string): string {
  const list = candidates.map((c) => ({ term: c.term, count: c.count, contexts: c.snippets }));
  return `${bookTitle ? `Book: ${bookTitle}\n\n` : ''}Candidates (JSON):\n${JSON.stringify(list)}`;
}

/**
 * Parses `{"entries":[…]}` (also `{"glossary":[…]}` or a bare array). Invalid items are skipped; a missing or
 * unknown type becomes "other"; `count` is taken from the candidate with the same folded term.
 */
export function parseClassifyAnswer(text: string, candidates: readonly GlossaryCandidate[]): GlossaryEntry[] {
  const json = extractJson(text) as { entries?: unknown; glossary?: unknown } | unknown[] | null;
  const list = Array.isArray(json) ? json : (json?.entries ?? json?.glossary);
  if (!Array.isArray(list)) throw new Error('model answer has no "entries" array');
  const counts = new Map(candidates.map((c) => [foldGlossaryKey(c.term), c.count]));
  const out: GlossaryEntry[] = [];
  for (const item of list) {
    const { term, translation, type, note } = (item ?? {}) as Record<string, unknown>;
    if (typeof term !== 'string' || typeof translation !== 'string' || !term.trim() || !translation.trim()) continue;
    const kind = typeof type === 'string' ? type.trim().toLowerCase() : '';
    const count = counts.get(foldGlossaryKey(term));
    out.push({
      term: term.trim(),
      translation: translation.trim(),
      type: isGlossaryTermType(kind) ? kind : 'other',
      ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
      ...(count !== undefined ? { count } : {}),
    });
  }
  return out;
}

/**
 * Classifies and translates candidates in batches of `CLASSIFY_BATCH_SIZE`, with retry/backoff per request.
 * Fatal provider errors (bad key, unknown model) and aborts reject the whole call. A batch whose request still
 * fails after all retries (rate limit, outage, rejected content), or whose answer stays unparsable after a second
 * request, is skipped, so the batches already paid for are kept; only when every batch fails does the call reject.
 */
export async function classifyCandidates(
  candidates: readonly GlossaryCandidate[],
  provider: ChatProvider,
  settings: ProjectSettings,
  opts: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const batches: GlossaryCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += CLASSIFY_BATCH_SIZE) batches.push(candidates.slice(i, i + CLASSIFY_BATCH_SIZE));
  const system = buildClassifySystemPrompt(settings);
  const results: GlossaryEntry[][] = new Array(batches.length);
  let skippedBatches = 0;
  let done = 0;
  opts.onProgress?.(0, candidates.length);

  // The first failure cancels the requests still in flight.
  const controller = new AbortController();
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) throw abortError(opts.signal);
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const signal = controller.signal;

  let lastProviderError: ProviderError | undefined;
  const classify = async (index: number) => {
    const batch = batches[index] as GlossaryCandidate[];
    const user = buildClassifyUserMessage(batch, opts.bookTitle);
    for (let attempt = 1; ; attempt++) {
      let res: Awaited<ReturnType<ChatProvider['chat']>>;
      try {
        res = await withRetry(() => provider.chat({ system, user, maxTokens: MAX_OUTPUT_TOKENS, signal }), signal);
      } catch (err) {
        if (!(err instanceof ProviderError) || err.fatal || signal.aborted) throw err;
        lastProviderError = err;
        skippedBatches++;
        results[index] = [];
        break;
      }
      try {
        results[index] = parseClassifyAnswer(res.text, batch);
        break;
      } catch {
        if (attempt < PARSE_ATTEMPTS) continue;
        skippedBatches++;
        results[index] = [];
        break;
      }
    }
    done += batch.length;
    opts.onProgress?.(done, candidates.length);
  };

  const limit = Math.min(16, Math.max(1, Math.floor(opts.concurrency ?? 1)), batches.length);
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (next < batches.length && failure === undefined) {
      const index = next++;
      try {
        await classify(index);
      } catch (err) {
        if (failure === undefined) {
          failure = err;
          controller.abort(err);
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: limit }, worker));
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (failure !== undefined) throw failure;
  if (lastProviderError && skippedBatches === batches.length) throw lastProviderError;
  // Batch order, not completion order, keeps the result deterministic.
  return { entries: results.flat(), skippedBatches };
}
