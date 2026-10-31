import type { Translate } from '../../i18n/translate-message';

/** "3 errors" (singular-aware: the dictionaries have no plural rules). */
export const errorCountLabel = (t: Translate, n: number): string => (n === 1 ? t('reader.chapterErrorsOne') : t('reader.chapterErrors', { n }));

/** "N errors in M chapters" with the singular forms of each part. */
export function errorSummaryLabel(t: Translate, errors: number, chapters: number): string {
  if (errors === 1) return t('reader.errorSummaryOne');
  return chapters === 1 ? t('reader.errorSummaryOneChapter', { n: errors }) : t('reader.errorSummary', { n: errors, m: chapters });
}
