import type { Chapter } from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';
import type { ErrorIndex } from '../../lib/error-index';
import type { SegmentCounts } from '../../lib/segment-counts';
import { INPUT_CLASS } from '../ui/input-class';
import { errorCountLabel, errorSummaryLabel } from './error-labels';

interface ReaderChapterListProps {
  chapters: readonly Chapter[];
  progress: readonly SegmentCounts[];
  errors: ErrorIndex;
  /** Chapter indexes to list (all of them, or only those with errors when the filter is on). */
  visible: readonly number[];
  current: number;
  onSelect: (chapter: number) => void;
}

const chapterName = (c: Chapter): string => c.title || c.href;

/** Failed-segment count with an icon: the chapter is flagged by shape and number, not only by colour. */
function ErrorBadge({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <span
      data-testid="chapter-error-badge"
      role="img"
      aria-label={errorCountLabel(t, count)}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800 tabular-nums dark:bg-red-950 dark:text-red-300"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
        <path d="M8 1 .5 14.5h15L8 1Zm-.75 5h1.5v4.5h-1.5V6Zm0 5.5h1.5V13h-1.5v-1.5Z" />
      </svg>
      {count}
    </span>
  );
}

/** Chapter picker (a select on small screens, a list on wide ones) that flags chapters with failed segments. */
export function ReaderChapterList({ chapters, progress, errors, visible, current, onSelect }: ReaderChapterListProps) {
  const { t } = useI18n();
  const totalErrors = errors.locations.length;

  return (
    <aside className="space-y-2 md:sticky md:top-20 md:self-start">
      {totalErrors > 0 && (
        <p
          data-testid="error-summary"
          className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className="shrink-0">
            <path d="M8 1 .5 14.5h15L8 1Zm-.75 5h1.5v4.5h-1.5V6Zm0 5.5h1.5V13h-1.5v-1.5Z" />
          </svg>
          {errorSummaryLabel(t, totalErrors, errors.chaptersWithErrors)}
        </p>
      )}
      <div className="md:hidden">
        <label htmlFor="chapter-select" className="mb-1.5 block text-sm font-medium">
          {t('reader.chapters')}
        </label>
        <select id="chapter-select" className={INPUT_CLASS} value={current} onChange={(e) => onSelect(Number(e.target.value))}>
          {/* The current chapter stays selectable even when the errors-only filter hides it from the list. */}
          {chapters.map((c, i) =>
            visible.includes(i) || i === current ? (
              <option key={c.href + String(i)} value={i}>
                {chapterName(c)}
                {(errors.perChapter[i] ?? 0) > 0 ? ` (⚠ ${errorCountLabel(t, errors.perChapter[i] ?? 0)})` : ''}
              </option>
            ) : null,
          )}
        </select>
      </div>
      <nav
        aria-label={t('reader.chapters')}
        className="hidden max-h-[75vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-2 md:block dark:border-stone-800 dark:bg-stone-900"
      >
        <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{t('reader.chapters')}</h2>
        {visible.length === 0 ? (
          <p className="px-2 py-1 text-sm text-stone-500">{t('reader.noErrors')}</p>
        ) : (
          <ol className="space-y-0.5">
            {visible.map((i) => {
              const c = chapters[i];
              if (!c) return null;
              const failed = errors.perChapter[i] ?? 0;
              return (
                <li key={c.href + String(i)}>
                  <button
                    type="button"
                    data-testid="chapter-item"
                    data-errors={failed}
                    onClick={() => onSelect(i)}
                    aria-current={i === current ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-lg border-l-4 px-2 py-1.5 text-left text-sm transition ${
                      failed > 0 ? 'border-red-500' : 'border-transparent'
                    } ${
                      i === current
                        ? 'bg-teal-700/10 font-medium text-teal-900 dark:bg-teal-400/10 dark:text-teal-200'
                        : failed > 0
                          ? 'bg-red-50/70 hover:bg-red-100/70 dark:bg-red-950/20 dark:hover:bg-red-950/40'
                          : 'hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    <span className="line-clamp-2 flex-1">{chapterName(c)}</span>
                    {failed > 0 && <ErrorBadge count={failed} />}
                    <span className="shrink-0 text-[11px] text-stone-500 tabular-nums">
                      {progress[i]?.done}/{progress[i]?.total}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </nav>
    </aside>
  );
}
