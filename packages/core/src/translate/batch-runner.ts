import { isAbortError, ProviderError } from '../providers/provider-http';
import type { ChatProvider, ProjectSettings, Segment, TokenUsage } from '../types';
import { validateTranslationMarkup } from './markup-validation';
import {
  batchGlossary,
  buildReviewSystemPrompt,
  buildReviewUserMessage,
  buildTranslateSystemPrompt,
  buildTranslateUserMessage,
  parseSegmentsAnswer,
} from './prompt-protocol';
import { withRetry } from './retry-with-backoff';
import { estimateTokens } from './token-estimate';

export type BatchKind = 'translate' | 'review';

export interface BatchContext {
  provider: ChatProvider;
  settings: ProjectSettings;
  signal: AbortSignal;
  usage: TokenUsage;
  /**
   * Called exactly once per segment when its outcome for this pass is final. `superseded` is true
   * when the segment was left untouched because it changed (user edit, retranslation) meanwhile.
   */
  commit: (segment: Segment, superseded: boolean) => void;
  /** True when the segment changed since its batch was built; such a segment is never sent or overwritten. */
  isSuperseded?: (segment: Segment) => boolean;
  /** Consecutive non-retryable client errors (4xx) without any successful response. */
  clientErrors: number;
}

/** Attempts for a single segment whose answer keeps failing validation. */
const SINGLE_SEGMENT_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 8192;
/** Repeated 4xx answers mean a configuration problem (model, parameters), not bad content: stop the run. */
const MAX_CONSECUTIVE_CLIENT_ERRORS = 5;

function outputBudget(segments: Segment[]): number {
  const source = segments.reduce((n, s) => n + estimateTokens(s.sourceHtml), 0);
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(1024, source * 3 + 512));
}

/**
 * Sends one batch, validates every returned segment (id present, markup preserved) and
 * accepts valid ones. Rejected segments are split in halves and retried; a lone segment is
 * retried a few times before it is marked as failed.
 * Fatal provider errors (auth, unknown model) and aborts propagate to the caller.
 */
export async function runBatch(batch: Segment[], kind: BatchKind, ctx: BatchContext, attempt = 1): Promise<void> {
  const segments = current(batch, ctx);
  if (segments.length === 0) return;
  let answer: Map<string, string>;
  const glossary = batchGlossary(ctx.settings.glossary, segments, kind);
  try {
    const res = await withRetry(
      () =>
        ctx.provider.chat({
          system: kind === 'translate' ? buildTranslateSystemPrompt(ctx.settings) : buildReviewSystemPrompt(ctx.settings),
          user: kind === 'translate' ? buildTranslateUserMessage(segments, glossary) : buildReviewUserMessage(segments, glossary),
          maxTokens: outputBudget(segments),
          signal: ctx.signal,
        }),
      ctx.signal,
    );
    ctx.clientErrors = 0;
    if (res.usage) {
      ctx.usage.input += res.usage.input;
      ctx.usage.output += res.usage.output;
    }
    answer = parseSegmentsAnswer(res.text);
  } catch (err) {
    if (isAbortError(err) || ctx.signal.aborted) throw err;
    if (!(err instanceof ProviderError)) return splitOrFail(segments, kind, ctx, attempt, (err as Error).message);
    if (err.fatal) throw err;
    if (err.retryable) {
      // Retries are exhausted; splitting would not help with rate limits or outages.
      for (const s of segments) fail(s, kind, err.message, ctx);
      return;
    }
    if (++ctx.clientErrors >= MAX_CONSECUTIVE_CLIENT_ERRORS) throw err;
    // A 4xx may be caused by one segment (content filter, size): isolate it, but never retry it alone.
    if (segments.length === 1) return fail(segments[0] as Segment, kind, err.message, ctx);
    return splitOrFail(segments, kind, ctx, attempt, err.message);
  }

  const rejected: Segment[] = [];
  let reason = '';
  for (const segment of current(segments, ctx)) {
    const html = answer.get(segment.id);
    const problem = html === undefined ? 'segment missing from answer' : validateTranslationMarkup(segment.sourceHtml, html);
    if (problem || html === undefined) {
      rejected.push(segment);
      reason = problem ?? reason;
      continue;
    }
    segment.translationHtml = html;
    segment.status = kind === 'translate' ? 'translated' : 'reviewed';
    delete segment.error;
    ctx.commit(segment, false);
  }
  // A segment isolated from a larger batch starts its own count of single-segment attempts.
  if (rejected.length) await splitOrFail(rejected, kind, ctx, segments.length === 1 ? attempt : 0, reason);
}

async function splitOrFail(segments: Segment[], kind: BatchKind, ctx: BatchContext, attempt: number, reason: string): Promise<void> {
  if (segments.length > 1) {
    const mid = Math.ceil(segments.length / 2);
    await runBatch(segments.slice(0, mid), kind, ctx);
    await runBatch(segments.slice(mid), kind, ctx);
    return;
  }
  if (attempt < SINGLE_SEGMENT_ATTEMPTS) return runBatch(segments, kind, ctx, attempt + 1);
  const [segment] = segments;
  if (segment) fail(segment, kind, reason, ctx);
}

/** Commits superseded segments as such and returns the others. */
function current(segments: Segment[], ctx: BatchContext): Segment[] {
  if (!ctx.isSuperseded) return segments;
  return segments.filter((s) => {
    if (!ctx.isSuperseded?.(s)) return true;
    ctx.commit(s, true);
    return false;
  });
}

/** A failed review keeps the draft translation; a failed translation marks the segment as error. */
function fail(segment: Segment, kind: BatchKind, reason: string, ctx: BatchContext): void {
  if (ctx.isSuperseded?.(segment)) {
    ctx.commit(segment, true);
    return;
  }
  if (kind === 'translate') {
    segment.status = 'error';
    segment.error = reason;
  } else {
    segment.error = `review failed: ${reason}`;
  }
  ctx.commit(segment, false);
}
