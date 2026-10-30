import type { Project } from '@epubtrans/core';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { countChapterSegments } from '../../lib/segment-counts';
import { useActiveProvider } from '../../lib/use-active-provider';
import { INPUT_CLASS } from '../ui/input-class';
import { type ReaderMode, SegmentRow } from './segment-row';

/** Chapter navigation plus source/translation pairs of the selected chapter. */
export function ReaderPanel({ project, version }: { project: Project; version: number }) {
  const { t } = useI18n();
  const provider = useActiveProvider();
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      project.chapters.findIndex((c) => c.segments.some((s) => s.status === 'pending' || s.status === 'error')),
    ),
  );
  const [mode, setMode] = useState<ReaderMode>('side');
  const chapter = project.chapters[index] ?? project.chapters[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const progress = useMemo(() => project.chapters.map((c) => countChapterSegments([c])), [project, version]);

  if (!chapter) return <p className="text-sm text-stone-500">{t('reader.empty')}</p>;

  return (
    <div className="grid gap-5 md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="md:sticky md:top-20 md:self-start">
        <label htmlFor="chapter-select" className="mb-1.5 block text-sm font-medium md:hidden">
          {t('reader.chapters')}
        </label>
        <select id="chapter-select" className={`${INPUT_CLASS} md:hidden`} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {project.chapters.map((c, i) => (
            <option key={c.href + String(i)} value={i}>
              {c.title || c.href}
            </option>
          ))}
        </select>
        <nav
          aria-label={t('reader.chapters')}
          className="hidden max-h-[75vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-2 md:block dark:border-stone-800 dark:bg-stone-900"
        >
          <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{t('reader.chapters')}</h2>
          <ol className="space-y-0.5">
            {project.chapters.map((c, i) => (
              <li key={c.href + String(i)}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === index ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    i === index
                      ? 'bg-teal-700/10 font-medium text-teal-900 dark:bg-teal-400/10 dark:text-teal-200'
                      : 'hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  <span className="line-clamp-2 flex-1">{c.title || c.href}</span>
                  <span className="shrink-0 text-[11px] text-stone-500 tabular-nums">
                    {progress[i]?.done}/{progress[i]?.total}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <section className="min-w-0 rounded-2xl border border-stone-200 bg-white px-4 shadow-sm sm:px-6 dark:border-stone-800 dark:bg-stone-900">
        <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-stone-800 dark:bg-stone-900/95">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{chapter.title || chapter.href}</h2>
          <fieldset className="flex rounded-lg border border-stone-300 p-0.5 text-xs dark:border-stone-700">
            <legend className="sr-only">{t('reader.view')}</legend>
            {(['side', 'interleaved'] as const).map((m) => (
              <label key={m} className={`cursor-pointer rounded-md px-2.5 py-1 ${mode === m ? 'bg-teal-700 text-white' : ''}`}>
                <input type="radio" name="reader-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                {m === 'side' ? t('reader.sideBySide') : t('reader.interleaved')}
              </label>
            ))}
          </fieldset>
        </div>
        {mode === 'side' && (
          <div className="hidden grid-cols-2 gap-6 pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid">
            <span>{t('reader.source')}</span>
            <span>{t('reader.translation')}</span>
          </div>
        )}
        {chapter.segments.length === 0 ? (
          <p className="py-6 text-sm text-stone-500">{t('reader.emptyChapter')}</p>
        ) : (
          chapter.segments.map((s) => <SegmentRow key={s.id} project={project} segment={s} mode={mode} provider={provider} />)
        )}
      </section>
    </div>
  );
}
