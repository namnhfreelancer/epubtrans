import type { Chapter, Segment } from '../types';
import {
  type BatchNeighbours,
  chapterTitleOf,
  draftOf,
  polishContextSegments,
  polishContextText,
  sourceOf,
  translateContextItem,
  translateContextSegments,
} from './read-only-context';
import { countCjk, estimateTokens } from './token-estimate';

/**
 * Size of the read-only context of each request, for the cost estimate. The context is selected with the run's own
 * functions (`read-only-context.ts`), but sized from per-segment cached item sizes instead of serializing every
 * batch's context on each estimate: the web app re-estimates on every project change.
 */

export interface ContextChars {
  chars: number;
  cjk: number;
}

const countChars = (text: string): ContextChars => ({ chars: text.length, cjk: countCjk(text) });

/** `"chapter":`, `"context":[`, `]`, and the comma that joins the context keys to the rest of the message. */
const CHAPTER_KEY = '"chapter":'.length;
const CONTEXT_KEY = '"context":['.length + 1;
/** `"context_before":[]` / `"context_after":[]` with their separating comma, in tokens. */
const POLISH_KEY_TOKENS = 5;

/**
 * Positions of consecutive batches in their chapter, found by walking the chapter once: batches are built in chapter
 * order, so each lookup continues where the previous one stopped (linear in the chapter, no index map per estimate).
 */
export function neighboursInOrder(chapter: Chapter): (batch: Segment[]) => BatchNeighbours {
  let i = 0;
  const find = (s: Segment | undefined) => {
    while (i < chapter.segments.length && chapter.segments[i] !== s) i++;
    return Math.min(i, chapter.segments.length - 1);
  };
  return (batch) => {
    const first = find(batch[0]);
    return { chapterTitle: chapter.title, segments: chapter.segments, first, last: find(batch.at(-1)) };
  };
}

/** Drafts do not exist yet when the estimate runs: the source stands in for a missing draft in the polish context. */
export const draftOrSource = (s: Segment): string | undefined => draftOf(s) ?? (sourceOf(s) || undefined);

/** Translations are usually somewhat longer in tokens than their source. */
export const OUTPUT_RATIO = 1.3;

/**
 * A context segment that this run will still translate: it shows up in the context of a later batch with its
 * translation, whose size is not known yet. A text as long as the source times `OUTPUT_RATIO` (or its existing draft,
 * when that is longer) stands in, so the estimate stays an upper bound however the run orders its batches.
 */
const draftOrLongerSource = (s: Segment): string | undefined => {
  const draft = draftOf(s);
  const source = sourceOf(s);
  const expected = source + source.slice(0, Math.ceil(source.length * (OUTPUT_RATIO - 1)));
  return draft && draft.length > expected.length ? draft : expected || undefined;
};

interface ItemSizes {
  sourceText: string;
  status: Segment['status'];
  translationHtml: string | undefined;
  translate?: ContextChars;
  translateStandIn?: ContextChars;
  before?: number;
  after?: number;
}

const itemCache = new WeakMap<Segment, ItemSizes>();

/** The cached sizes of a segment as a context item; dropped when its text, status or translation changed. */
function itemSizes(s: Segment): ItemSizes {
  const cached = itemCache.get(s);
  if (cached && cached.sourceText === s.sourceText && cached.status === s.status && cached.translationHtml === s.translationHtml) return cached;
  const fresh: ItemSizes = { sourceText: s.sourceText, status: s.status, translationHtml: s.translationHtml };
  itemCache.set(s, fresh);
  return fresh;
}

const titleCache = new Map<string, ContextChars>();

function titleChars(title: string): ContextChars {
  let size = titleCache.get(title);
  if (!size) {
    size = countChars(JSON.stringify(title));
    if (titleCache.size > 1000) titleCache.clear();
    titleCache.set(title, size);
  }
  return size;
}

/**
 * Characters the translate context adds inside the user message object (0 when it has none). `willTranslate` marks
 * the context segments that this run translates before they are read as context.
 */
export function translateContextChars(n: BatchNeighbours, willTranslate: (s: Segment) => boolean = () => false): ContextChars {
  const title = chapterTitleOf(n);
  const items = translateContextSegments(n);
  const out: ContextChars = { chars: 0, cjk: 0 };
  if (title) {
    const size = titleChars(title);
    out.chars += CHAPTER_KEY + size.chars + 1;
    out.cjk += size.cjk;
  }
  if (items.length) {
    out.chars += CONTEXT_KEY + items.length;
    for (const s of items) {
      const sizes = itemSizes(s);
      let size: ContextChars;
      if (willTranslate(s)) {
        sizes.translateStandIn ??= countChars(JSON.stringify(translateContextItem(s, draftOrLongerSource)));
        size = sizes.translateStandIn;
      } else {
        sizes.translate ??= countChars(JSON.stringify(translateContextItem(s)));
        size = sizes.translate;
      }
      out.chars += size.chars;
      out.cjk += size.cjk;
    }
  }
  return out;
}

/** Tokens of the polish context (chapter title and neighbouring drafts, the source standing in for missing ones). */
export function polishContextTokens(n: BatchNeighbours): number {
  const title = chapterTitleOf(n);
  const { before, after } = polishContextSegments(n, draftOrSource);
  let tokens = title ? Math.ceil((CHAPTER_KEY + titleChars(title).chars) / 4) : 0;
  for (const [side, segments] of [
    ['before', before],
    ['after', after],
  ] as const) {
    if (!segments.length) continue;
    tokens += POLISH_KEY_TOKENS;
    for (const s of segments) {
      const sizes = itemSizes(s);
      sizes[side] ??= estimateTokens(JSON.stringify(polishContextText(draftOrSource(s) as string, side)));
      tokens += sizes[side];
    }
  }
  return tokens;
}
