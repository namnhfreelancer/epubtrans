import type { Chapter, Segment, SegmentStatus } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { errorSummaryLabel } from '../src/components/reader/error-labels';
import { translate } from '../src/i18n/translate-message';
import { buildErrorIndex, errorOrdinal, findAdjacentError, locateSegment } from '../src/lib/error-index';
import { parseHash, routeHref } from '../src/lib/hash-route';
import { segmentErrorText } from '../src/lib/segment-error-text';

const seg = (id: string, status: SegmentStatus): Segment => ({ id, sourceHtml: id, sourceText: id, status });
const chapter = (name: string, ...segments: Segment[]): Chapter => ({ href: `${name}.xhtml`, title: name, segments }) as Chapter;

/** c0: e0a ok e0b | c1: no errors | c2: (empty) | c3: e3a | c4: ok e4a e4b */
const book = [
  chapter('c0', seg('e0a', 'error'), seg('ok0', 'translated'), seg('e0b', 'error')),
  chapter('c1', seg('ok1', 'reviewed'), seg('p1', 'pending')),
  chapter('c2'),
  chapter('c3', seg('e3a', 'error')),
  chapter('c4', seg('ok4', 'translated'), seg('e4a', 'error'), seg('e4b', 'error')),
];

describe('error index', () => {
  it('lists failed segments in reading order across chapters', () => {
    const index = buildErrorIndex(book);
    expect(index.locations.map((l) => l.id)).toEqual(['e0a', 'e0b', 'e3a', 'e4a', 'e4b']);
    expect(index.locations.map((l) => [l.chapter, l.segment])).toEqual([
      [0, 0],
      [0, 2],
      [3, 0],
      [4, 1],
      [4, 2],
    ]);
  });

  it('counts failures per chapter and the chapters affected', () => {
    const index = buildErrorIndex(book);
    expect(index.perChapter).toEqual([2, 0, 0, 1, 2]);
    expect(index.chaptersWithErrors).toBe(3);
  });

  it('is empty for a book without failures', () => {
    const index = buildErrorIndex([chapter('a', seg('x', 'translated'), seg('y', 'pending'))]);
    expect(index).toEqual({ locations: [], perChapter: [0], chaptersWithErrors: 0 });
    expect(findAdjacentError(index, { chapter: 0, segment: -1 }, 1)).toBeUndefined();
    expect(findAdjacentError(index, { chapter: 0, segment: -1 }, -1)).toBeUndefined();
  });

  it('numbers errors from 1 and ignores segments that are not errors', () => {
    const index = buildErrorIndex(book);
    expect(errorOrdinal(index, 'e0a')).toBe(1);
    expect(errorOrdinal(index, 'e4b')).toBe(5);
    expect(errorOrdinal(index, 'ok0')).toBeUndefined();
  });

  it('locates any segment by id', () => {
    expect(locateSegment(book, 'p1')).toEqual({ chapter: 1, segment: 1, id: 'p1' });
    expect(locateSegment(book, 'missing')).toBeUndefined();
  });
});

describe('error navigation', () => {
  const index = buildErrorIndex(book);
  const walk = (from: { chapter: number; segment: number }, direction: 1 | -1): string[] => {
    const seen: string[] = [];
    let at = findAdjacentError(index, from, direction);
    while (at) {
      seen.push(at.id);
      at = findAdjacentError(index, at, direction);
    }
    return seen;
  };

  it('steps forward across chapters, skipping chapters without errors', () => {
    expect(walk({ chapter: 0, segment: -1 }, 1)).toEqual(['e0a', 'e0b', 'e3a', 'e4a', 'e4b']);
  });

  it('steps backward across chapters', () => {
    expect(walk({ chapter: 4, segment: 99 }, -1)).toEqual(['e4b', 'e4a', 'e3a', 'e0b', 'e0a']);
  });

  it('stops at both ends instead of wrapping', () => {
    expect(findAdjacentError(index, { chapter: 4, segment: 2 }, 1)).toBeUndefined();
    expect(findAdjacentError(index, { chapter: 0, segment: 0 }, -1)).toBeUndefined();
  });

  it('searches from the start of the current chapter when nothing was visited yet', () => {
    // Viewing chapter 3 with no cursor: next is its own first error, previous is the last error before it.
    expect(findAdjacentError(index, { chapter: 3, segment: -1 }, 1)?.id).toBe('e3a');
    expect(findAdjacentError(index, { chapter: 3, segment: -1 }, -1)?.id).toBe('e0b');
    // A chapter without errors: next skips ahead, previous looks back.
    expect(findAdjacentError(index, { chapter: 1, segment: -1 }, 1)?.id).toBe('e3a');
    expect(findAdjacentError(index, { chapter: 2, segment: -1 }, -1)?.id).toBe('e0b');
  });

  it('keeps working from a segment that was an error but got fixed', () => {
    const fixed = buildErrorIndex([chapter('c0', seg('e0a', 'error'), seg('was-error', 'translated'), seg('e0b', 'error'))]);
    const cursor = { chapter: 0, segment: 1 };
    expect(findAdjacentError(fixed, cursor, 1)?.id).toBe('e0b');
    expect(findAdjacentError(fixed, cursor, -1)?.id).toBe('e0a');
  });
});

describe('segment error text', () => {
  it('drops the retranslation wrapper, however often it was applied', () => {
    expect(segmentErrorText('Retranslation failed: inline tags were not preserved')).toBe('inline tags were not preserved');
    expect(segmentErrorText('Retranslation failed: retranslation failed: boom')).toBe('boom');
    expect(segmentErrorText('  retranslation FAILED:boom ')).toBe('boom');
  });

  it('keeps other messages untouched and drops empty ones', () => {
    expect(segmentErrorText('rate limited')).toBe('rate limited');
    expect(segmentErrorText('Request: Retranslation failed: x')).toBe('Request: Retranslation failed: x');
    expect(segmentErrorText('Retranslation failed:')).toBeUndefined();
    expect(segmentErrorText(undefined)).toBeUndefined();
  });

  it('shows the label once when composed with the UI message', () => {
    const message = translate('en', 'reader.retranslateFailed', { message: segmentErrorText('Retranslation failed: nope') ?? '' });
    expect(message).toBe('Retranslation failed: nope');
  });
});

describe('error summary labels', () => {
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('en', key, params);
  it('picks singular and plural forms', () => {
    expect(errorSummaryLabel(t, 17, 4)).toBe('17 errors in 4 chapters');
    expect(errorSummaryLabel(t, 3, 1)).toBe('3 errors in 1 chapter');
    expect(errorSummaryLabel(t, 1, 1)).toBe('1 error in 1 chapter');
  });
});

describe('reader deep link', () => {
  it('round-trips a segment id on the read tab only', () => {
    const route = { name: 'book', id: 'b1', tab: 'read', segment: 'ch/1#s 2' } as const;
    expect(parseHash(routeHref(route))).toEqual(route);
    expect(routeHref({ name: 'book', id: 'b1', tab: 'read' })).toBe('#/book/b1/read');
    expect(parseHash('#/book/b1/export/s1')).toEqual({ name: 'book', id: 'b1', tab: 'export' });
  });
});
