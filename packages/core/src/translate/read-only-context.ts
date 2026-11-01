import type { Chapter, Segment } from '../types';

/**
 * Read-only context sent with a batch, in the USER message so the system prompt stays byte-identical (cacheable)
 * for every batch of a run. The model reads it for coreference, register and flow, but never translates or returns
 * it: its items carry no ids, and the answer validation only ever reads the requested segment ids.
 */

/** Passages before a translate batch: enough for pronouns and register, small enough to stay a few % of input. */
export const TRANSLATE_CONTEXT_BEFORE = 3;
/** Drafts around a polish batch (they all exist when the polish pass runs, so this costs no parallelism). */
export const POLISH_CONTEXT_BEFORE = 2;
export const POLISH_CONTEXT_AFTER = 1;
/** Characters kept per context item; a longer one is cut at the side away from the batch. */
export const MAX_CONTEXT_ITEM_CHARS = 600;
/** Characters kept of a chapter title. */
const MAX_CHAPTER_TITLE_CHARS = 200;
/** Segments scanned past empty ones (images, page markers) before giving up on finding more context. */
const MAX_SCAN = 12;

/** Where a batch sits in its chapter: the chapter's segments and the indexes of the batch's first and last segment. */
export interface BatchNeighbours {
  chapterTitle: string;
  segments: readonly Segment[];
  first: number;
  last: number;
}

/** One preceding passage of a translate batch; `translation` only when that passage is already translated. */
export interface TranslateContextItem {
  source: string;
  translation?: string;
}

export interface TranslateContext {
  chapter?: string;
  context?: TranslateContextItem[];
}

export interface PolishContext {
  chapter?: string;
  context_before?: string[];
  context_after?: string[];
}

/** Finds a batch's neighbours by segment id, so copies of segments (samples, retranslation) resolve too. */
export type NeighbourLookup = (batch: readonly Segment[]) => BatchNeighbours | undefined;

/** Plain text of an HTML fragment: line breaks become spaces, other tags are dropped, whitespace collapsed. */
export const plainText = (html: string): string =>
  html
    .replace(/<br\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Collapses a title to one line (a metadata title must not be able to open a new prompt section) and caps it. */
export const oneLine = (text: string, max: number): string => cap(text.replace(/\s+/g, ' ').trim(), max, 'end');

function cap(text: string, max: number, keep: 'start' | 'end'): string {
  if (text.length <= max) return text;
  // Never cut a surrogate pair in half: a lone surrogate makes some APIs reject the request body.
  if (keep === 'end')
    return `${text
      .slice(0, max - 1)
      .replace(/[\uD800-\uDBFF]$/, '')
      .trimEnd()}…`;
  return `…${text
    .slice(text.length - max + 1)
    .replace(/^[\uDC00-\uDFFF]/, '')
    .trimStart()}`;
}

/**
 * Plain texts per segment, keyed by the HTML they came from: the cost estimate rebuilds every batch's context on each
 * project change, so a segment's text is only flattened again when it changed.
 */
const plainCache = new WeakMap<Segment, { source?: [string, string]; draft?: [string, string] }>();

function cachedPlain(s: Segment, kind: 'source' | 'draft', html: string): string {
  let entry = plainCache.get(s);
  if (!entry) {
    entry = {};
    plainCache.set(s, entry);
  }
  const hit = entry[kind];
  if (hit && hit[0] === html) return hit[1];
  const text = plainText(html);
  entry[kind] = [html, text];
  return text;
}

/** Plain source text of a segment. */
export const sourceOf = (s: Segment): string => cachedPlain(s, 'source', s.sourceText || s.sourceHtml);

/** The current machine or hand translation of a finished segment; a pending one may hold a stale one (old target). */
export const draftOf = (s: Segment): string | undefined =>
  (s.status === 'translated' || s.status === 'reviewed') && s.translationHtml ? cachedPlain(s, 'draft', s.translationHtml) || undefined : undefined;

/**
 * Up to `count` segments next to `from` (exclusive) in direction `step`, nearest first, skipping segments without text.
 */
function nearby(segments: readonly Segment[], from: number, step: 1 | -1, count: number, text: (s: Segment) => string | undefined): Segment[] {
  const out: Segment[] = [];
  for (let i = from + step, scanned = 0; i >= 0 && i < segments.length && out.length < count && scanned < MAX_SCAN; i += step, scanned++) {
    const s = segments[i] as Segment;
    if (text(s)) out.push(s);
  }
  return out;
}

/** The chapter title as sent (one line, capped), or undefined for an untitled chapter. */
export const chapterTitleOf = (n: BatchNeighbours): string | undefined =>
  n.chapterTitle.trim() ? oneLine(n.chapterTitle, MAX_CHAPTER_TITLE_CHARS) : undefined;

/** The segments right before a translate batch that form its context, in reading order. */
export const translateContextSegments = (n: BatchNeighbours): Segment[] => nearby(n.segments, n.first, -1, TRANSLATE_CONTEXT_BEFORE, sourceOf).reverse();

/** One context passage: the capped source, plus the capped translation when the segment has one. */
export function translateContextItem(s: Segment): TranslateContextItem {
  const translation = draftOf(s);
  return {
    source: cap(sourceOf(s), MAX_CONTEXT_ITEM_CHARS, 'start'),
    ...(translation ? { translation: cap(translation, MAX_CONTEXT_ITEM_CHARS, 'start') } : {}),
  };
}

/** Chapter title and the passages right before a translate batch (source, plus translation when available), in reading order. */
export function translateContextOf(n: BatchNeighbours | undefined): TranslateContext {
  if (!n) return {};
  const chapter = chapterTitleOf(n);
  const context = translateContextSegments(n).map(translateContextItem);
  return { ...(chapter ? { chapter } : {}), ...(context.length ? { context } : {}) };
}

/** The segments whose drafts surround a polish batch, each side in reading order. */
export function polishContextSegments(n: BatchNeighbours, draft: (s: Segment) => string | undefined = draftOf): { before: Segment[]; after: Segment[] } {
  return {
    before: nearby(n.segments, n.first, -1, POLISH_CONTEXT_BEFORE, draft).reverse(),
    after: nearby(n.segments, n.last, 1, POLISH_CONTEXT_AFTER, draft),
  };
}

/** A draft as polish context, capped on the side away from the batch. */
export const polishContextText = (draft: string, side: 'before' | 'after'): string => cap(draft, MAX_CONTEXT_ITEM_CHARS, side === 'before' ? 'start' : 'end');

/**
 * Chapter title and the drafts around a polish batch, in reading order. `draft` reads a segment's draft; the cost
 * estimate passes one that falls back to the source, because drafts do not exist yet when it runs.
 */
export function polishContextOf(n: BatchNeighbours | undefined, draft: (s: Segment) => string | undefined = draftOf): PolishContext {
  if (!n) return {};
  const chapter = chapterTitleOf(n);
  const { before, after } = polishContextSegments(n, draft);
  const text = (side: 'before' | 'after') => (s: Segment) => polishContextText(draft(s) as string, side);
  return {
    ...(chapter ? { chapter } : {}),
    ...(before.length ? { context_before: before.map(text('before')) } : {}),
    ...(after.length ? { context_after: after.map(text('after')) } : {}),
  };
}

/** Indexes every segment id of `chapters` once; a batch resolves to its first and last segment's positions. */
export function neighbourLookup(chapters: readonly Chapter[]): NeighbourLookup {
  const where = new Map<string, { chapter: Chapter; index: number }>();
  for (const chapter of chapters) {
    chapter.segments.forEach((s, index) => {
      where.set(s.id, { chapter, index });
    });
  }
  return (batch) => {
    const first = batch[0] && where.get(batch[0].id);
    const last = batch.at(-1) && where.get((batch.at(-1) as Segment).id);
    if (!first) return undefined;
    const end = last && last.chapter === first.chapter && last.index >= first.index ? last.index : first.index;
    return { chapterTitle: first.chapter.title, segments: first.chapter.segments, first: first.index, last: end };
  };
}
