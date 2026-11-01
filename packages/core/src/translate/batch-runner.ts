import { isAbortError, ProviderError } from '../providers/provider-http';
import type { ChatProvider, ProjectSettings, Segment, TokenUsage } from '../types';
import { redactSecrets } from '../util/redact-secrets';
import { type DetachedElement, detachEmptyElements, restoreDetachedElements } from './empty-element-markers';
import { isIdenticalTranslation } from './identical-translation';
import { validateTranslationMarkup } from './markup-validation';
import {
  batchGlossary,
  buildPolishSystemPrompt,
  buildPolishUserMessage,
  buildTranslateSystemPrompt,
  buildTranslateUserMessage,
  type PromptBook,
  parseSegmentsAnswer,
} from './prompt-protocol';
import { type NeighbourLookup, polishContextOf, translateContextOf } from './read-only-context';
import { withRetry } from './retry-with-backoff';
import { estimateTokens } from './token-estimate';
import { addUsage } from './usage-cost';

/** `review` is the optional second pass, which polishes the drafts for natural style (setting `twoPass`). */
export type BatchKind = 'translate' | 'review';

export interface BatchContext {
  provider: ChatProvider;
  settings: ProjectSettings;
  /** Title and author, part of the (cache-stable) system prompt. */
  book: PromptBook;
  /**
   * Where a batch sits in the book, for the read-only context of the user message (chapter title, neighbouring
   * passages). Looked up again for every split or retried sub-batch, so a lone retried segment keeps its context.
   */
  neighbours: NeighbourLookup;
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

/** What the model sees of a segment: empty marker elements detached from the source (and from the review draft). */
interface WireSegment {
  wire: Segment;
  detached: DetachedElement[];
}

function toWire(segment: Segment, kind: BatchKind): WireSegment {
  const source = detachEmptyElements(segment.sourceHtml);
  if (kind === 'translate') return { wire: { ...segment, sourceHtml: source.html }, detached: source.detached };
  const draft = detachEmptyElements(segment.translationHtml ?? '');
  // A draft carrying exactly the source markers has them at translated positions, which fit the reviewed text better.
  const sameMarkers = draft.detached.length === source.detached.length && draft.detached.every((d, i) => d.markup === source.detached[i]?.markup);
  return {
    wire: { ...segment, sourceHtml: source.html, translationHtml: draft.html },
    detached: sameMarkers ? draft.detached : source.detached,
  };
}

/**
 * Validates an answer against the reduced source, then restores the detached markers. The restored HTML is checked
 * against the full source as well, so a stored translation always carries exactly the source tags.
 */
function acceptAnswer(segment: Segment, prepared: WireSegment, html: string): { html: string } | { problem: string } {
  const problem = validateTranslationMarkup(prepared.wire.sourceHtml, html);
  if (problem) return { problem };
  const restored = restoreDetachedElements(html, prepared.detached);
  const restoredProblem = validateTranslationMarkup(segment.sourceHtml, restored);
  return restoredProblem ? { problem: `restoring empty elements failed: ${restoredProblem}` } : { html: restored };
}

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
  const prepared = new Map(segments.map((s) => [s, toWire(s, kind)]));
  const wire = segments.map((s) => (prepared.get(s) as WireSegment).wire);
  const neighbours = ctx.neighbours(segments);
  try {
    const res = await withRetry(
      () =>
        ctx.provider.chat({
          system: kind === 'translate' ? buildTranslateSystemPrompt(ctx.settings, ctx.book) : buildPolishSystemPrompt(ctx.settings, ctx.book),
          user:
            kind === 'translate'
              ? buildTranslateUserMessage(wire, glossary, translateContextOf(neighbours))
              : buildPolishUserMessage(wire, glossary, polishContextOf(neighbours)),
          maxTokens: outputBudget(wire),
          signal: ctx.signal,
        }),
      ctx.signal,
    );
    ctx.clientErrors = 0;
    if (res.usage) addUsage(ctx.usage, res.usage);
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
    const result = html === undefined ? { problem: 'segment missing from answer' } : acceptAnswer(segment, prepared.get(segment) as WireSegment, html);
    if ('problem' in result) {
      rejected.push(segment);
      reason = result.problem;
      continue;
    }
    segment.translationHtml = result.html;
    segment.status = kind === 'translate' ? 'translated' : 'reviewed';
    delete segment.error;
    if (isIdenticalTranslation(segment.sourceHtml, result.html, ctx.settings)) segment.warning = 'identical';
    else delete segment.warning;
    // The stored translation is the model's now, no longer a hand edit.
    delete segment.userEdited;
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

/** A failed polish keeps the draft translation; a failed translation marks the segment as error. */
function fail(segment: Segment, kind: BatchKind, reason: string, ctx: BatchContext): void {
  if (ctx.isSuperseded?.(segment)) {
    ctx.commit(segment, true);
    return;
  }
  // The reason is persisted and shown to the user: never let a credential an error echoed reach it.
  const safe = redactSecrets(reason);
  if (kind === 'translate') {
    segment.status = 'error';
    segment.error = safe;
  } else {
    segment.error = `polish failed: ${safe}`;
  }
  ctx.commit(segment, false);
}
