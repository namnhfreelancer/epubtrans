import type { Chapter, ChatProvider, Project, ProjectSettings, Segment, TranslateOptions, TranslationPhase } from '../types';
import { type BatchContext, type BatchKind, runBatch } from './batch-runner';
import { abortError } from './retry-with-backoff';
import { estimateTokens } from './token-estimate';

/** Source-token budget per request. */
export const MAX_BATCH_TOKENS = 1500;
export const MAX_CONCURRENCY = 16;

/** Splits consecutive segments into batches of at most `maxTokens` source tokens (one oversized segment per batch). */
export function makeBatches(segments: Segment[], maxTokens = MAX_BATCH_TOKENS): Segment[][] {
  const batches: Segment[][] = [];
  let current: Segment[] = [];
  let tokens = 0;
  for (const s of segments) {
    const t = estimateTokens(s.sourceHtml);
    if (current.length && tokens + t > maxTokens) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(s);
    tokens += t;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function validateSettings(settings: ProjectSettings): void {
  if (!settings.targetLang?.trim()) throw new Error('Target language is required');
  if (!Number.isFinite(settings.concurrency) || settings.concurrency < 1) throw new Error('Concurrency must be at least 1');
}

const concurrencyOf = (settings: ProjectSettings) => Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(settings.concurrency)));

/** What a user edit or a retranslation changes; compared against the state when the phase started. */
const revisionOf = (s: Segment) => `${s.status}\u0000${s.translationHtml ?? ''}`;

/**
 * Translates every segment that is 'pending' or 'error' (finished segments are skipped, which makes
 * runs resumable), then — when `settings.twoPass` — reviews every 'translated' segment.
 * Segments are mutated in place and reported through `onSegment` for persistence. A segment changed by
 * someone else during the run (manual edit, retranslation) is left as is and not reported.
 * Rejects on abort or on a fatal provider error (bad key, unknown model); other failures mark segments as 'error'.
 */
export async function translateProject(project: Project, provider: ChatProvider, settings: ProjectSettings, opts: TranslateOptions = {}): Promise<void> {
  validateSettings(settings);
  const controller = new AbortController();
  const onAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) throw abortError(opts.signal);
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const usage = { input: 0, output: 0 };
  try {
    await runPhase(project, 'translate', (s) => s.status === 'pending' || s.status === 'error');
    if (settings.twoPass) await runPhase(project, 'review', (s) => s.status === 'translated');
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }

  async function runPhase(p: Project, phase: TranslationPhase, select: (s: Segment) => boolean): Promise<void> {
    const chapterOf = new Map<string, Chapter>();
    const revisions = new Map<Segment, string>();
    const batches: Segment[][] = [];
    for (const chapter of p.chapters) {
      const selected = chapter.segments.filter(select);
      for (const s of selected) {
        chapterOf.set(s.id, chapter);
        revisions.set(s, revisionOf(s));
      }
      batches.push(...makeBatches(selected));
    }
    const total = chapterOf.size;
    let done = 0;
    const report = () => opts.onProgress?.({ phase, done, total, usage: { ...usage } });
    report();
    if (total === 0) return;
    const ctx: BatchContext = {
      provider,
      settings,
      signal: controller.signal,
      usage,
      clientErrors: 0,
      isSuperseded: (segment) => revisions.get(segment) !== revisionOf(segment),
      commit: (segment, superseded) => {
        done++;
        if (!superseded) {
          p.updatedAt = new Date().toISOString();
          const chapter = chapterOf.get(segment.id);
          if (chapter) opts.onSegment?.(segment, chapter);
        }
        report();
      },
    };
    await runPool(batches, concurrencyOf(settings), (batch) => runBatch(batch, phase as BatchKind, ctx), controller);
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. The first failure aborts the
 * shared controller so other workers stop, and the pool only settles once every worker has
 * stopped (no callbacks fire after the returned promise settles).
 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, controller: AbortController): Promise<void> {
  let next = 0;
  let firstError: unknown;
  const loop = async () => {
    while (next < items.length) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      const item = items[next++] as T;
      try {
        await worker(item);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        if (!controller.signal.aborted) controller.abort(err);
        throw err;
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, loop));
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected) throw firstError ?? rejected.reason;
}
