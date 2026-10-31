import { TOC_CHAPTER_TITLE } from '../import/import-book';
import type { Chapter, Project } from '../types';
import { estimateTokens } from './token-estimate';

export const GUIDE_PASSAGES = 18;
/** Source tokens per passage, about 230 English words. */
export const PASSAGE_TOKENS = 300;

export interface BookPassage {
  chapter: string;
  text: string;
}

/** Content chapters: the table of contents duplicates chapter titles and carries no prose. */
export const contentChapters = (project: Project): Chapter[] => project.chapters.filter((c) => c.title !== TOC_CHAPTER_TITLE);

/**
 * Picks `count` passages of about `tokens` source tokens each, centred on evenly spaced points of the
 * book's text (so the beginning, middle and end are all represented). Each passage is a run of
 * consecutive segments from one chapter. A book shorter than `count × tokens` is returned whole. Deterministic.
 */
export function sampleBookPassages(project: Project, count = GUIDE_PASSAGES, tokens = PASSAGE_TOKENS): BookPassage[] {
  const items = contentChapters(project).flatMap((chapter) =>
    chapter.segments.filter((s) => s.sourceText.trim()).map((s) => ({ chapter, text: s.sourceText, tokens: estimateTokens(s.sourceText) })),
  );
  if (items.length === 0) return [];
  const starts: number[] = [];
  let total = 0;
  for (const item of items) {
    starts.push(total);
    total += item.tokens;
  }
  const passages: BookPassage[] = [];
  let nextFree = 0;
  const short = total <= count * tokens;
  for (let k = 0; nextFree < items.length && (short || k < count); k++) {
    let i = short ? nextFree : Math.max(nextFree, upperBound(starts, ((k + 0.5) * total) / count - tokens / 2) - 1);
    const chapter = (items[i] as (typeof items)[number]).chapter;
    const texts: string[] = [];
    let size = 0;
    while (i < items.length && size < tokens && (items[i] as (typeof items)[number]).chapter === chapter) {
      const item = items[i] as (typeof items)[number];
      texts.push(item.text);
      size += item.tokens;
      i++;
    }
    passages.push({ chapter: chapter.title, text: texts.join('\n') });
    nextFree = i;
  }
  return passages;
}

/** Index of the first element greater than `value` in an ascending array. */
function upperBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
