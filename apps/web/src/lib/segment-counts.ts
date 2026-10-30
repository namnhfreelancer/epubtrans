import type { Chapter, Project, SegmentStatus } from '@epubtrans/core';

export type SegmentCounts = Record<SegmentStatus, number> & { total: number; done: number };

export function countChapterSegments(chapters: Chapter[]): SegmentCounts {
  const counts: SegmentCounts = { total: 0, done: 0, pending: 0, translated: 0, reviewed: 0, error: 0 };
  for (const chapter of chapters) {
    for (const s of chapter.segments) {
      counts.total++;
      counts[s.status]++;
    }
  }
  counts.done = counts.translated + counts.reviewed;
  return counts;
}

export const countSegments = (project: Project): SegmentCounts => countChapterSegments(project.chapters);

/** Segments a run would still process: untranslated ones, plus unreviewed drafts in two-pass mode. */
export const remainingWork = (counts: SegmentCounts, twoPass: boolean): number => counts.pending + counts.error + (twoPass ? counts.translated : 0);
