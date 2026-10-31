import type { Chapter } from '@epubtrans/core';

/** Where a segment sits in the book: chapter index, then index inside the chapter. */
export interface SegmentLocation {
  chapter: number;
  segment: number;
  id: string;
}

export interface ErrorIndex {
  /** Failed segments in reading order (chapter by chapter). */
  locations: SegmentLocation[];
  /** Failed segment count per chapter, parallel to the chapter list. */
  perChapter: number[];
  chaptersWithErrors: number;
}

export type StepDirection = 1 | -1;

type Position = Pick<SegmentLocation, 'chapter' | 'segment'>;

/** Collects every segment whose status is `error`, in reading order. */
export function buildErrorIndex(chapters: readonly Chapter[]): ErrorIndex {
  const locations: SegmentLocation[] = [];
  const perChapter = chapters.map((chapter, c) => {
    let count = 0;
    chapter.segments.forEach((s, i) => {
      if (s.status !== 'error') return;
      locations.push({ chapter: c, segment: i, id: s.id });
      count++;
    });
    return count;
  });
  return { locations, perChapter, chaptersWithErrors: perChapter.filter((n) => n > 0).length };
}

/** Finds a segment by id anywhere in the book (used for deep links), whatever its status. */
export function locateSegment(chapters: readonly Chapter[], id: string): SegmentLocation | undefined {
  for (let c = 0; c < chapters.length; c++) {
    const segment = chapters[c]?.segments.findIndex((s) => s.id === id) ?? -1;
    if (segment >= 0) return { chapter: c, segment, id };
  }
  return undefined;
}

const compare = (a: Position, b: Position): number => a.chapter - b.chapter || a.segment - b.segment;

/**
 * The error right after (`1`) or before (`-1`) `from`, or undefined at the ends: navigation stops
 * instead of wrapping, so the UI disables the button there. `from` need not be an error itself
 * (it may have just been fixed); use `segment: -1` to mean "before the first segment of that chapter".
 */
export function findAdjacentError(index: ErrorIndex, from: Position, direction: StepDirection): SegmentLocation | undefined {
  const { locations } = index;
  if (direction === 1) return locations.find((l) => compare(l, from) > 0);
  for (let i = locations.length - 1; i >= 0; i--) {
    const l = locations[i];
    if (l && compare(l, from) < 0) return l;
  }
  return undefined;
}

/** 1-based position of the error with `id` among all errors, or undefined when it is not (or no longer) an error. */
export function errorOrdinal(index: ErrorIndex, id: string): number | undefined {
  const at = index.locations.findIndex((l) => l.id === id);
  return at >= 0 ? at + 1 : undefined;
}
