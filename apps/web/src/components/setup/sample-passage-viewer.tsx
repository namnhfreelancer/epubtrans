import type { Project, SampleSelection } from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';
import { SegmentText } from '../reader/segment-row';

/** The sampled passages, one block per chapter, with every segment as a source / translation pair. */
export function SamplePassageViewer({ project, selection }: { project: Project; selection: SampleSelection }) {
  const { t } = useI18n();
  const { sourceLang, targetLang } = project.settings;
  const segments = new Map(project.chapters.flatMap((c) => c.segments.map((s) => [s.id, s] as const)));

  return (
    <div data-testid="sample-viewer" className="mt-4 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('sample.viewerTitle')}</h3>
        <span className="text-xs text-stone-500 dark:text-stone-400">{t('sample.seed', { seed: selection.seed })}</span>
      </div>
      {selection.passages.map((passage, index) => (
        <section key={passage.chapterHref} data-testid="sample-passage" className="rounded-xl border border-stone-200 px-4 dark:border-stone-800">
          <h4 className="border-b border-stone-200 py-2 text-sm font-medium dark:border-stone-800">
            {t('sample.passageHeading', { n: index + 1, title: passage.chapterTitle })}
          </h4>
          <div className="hidden gap-6 pt-2 text-xs font-medium uppercase tracking-wide text-stone-500 md:grid md:grid-cols-2 dark:text-stone-400">
            <span>{t('sample.source')}</span>
            <span>{t('sample.translation')}</span>
          </div>
          {passage.segmentIds.map((id) => {
            const segment = segments.get(id);
            if (!segment) return null;
            return (
              <article
                key={id}
                data-testid="sample-segment"
                data-segment-id={id}
                className="grid gap-3 border-b border-stone-200 py-3 last:border-b-0 md:grid-cols-2 md:gap-6 dark:border-stone-800"
              >
                <SegmentText html={segment.sourceHtml} lang={sourceLang === 'auto' ? undefined : sourceLang} />
                <div data-testid="sample-translation">
                  {segment.translationHtml && segment.status !== 'error' ? (
                    <SegmentText html={segment.translationHtml} lang={targetLang} />
                  ) : segment.error ? (
                    <p className="text-sm text-red-700 dark:text-red-400">{segment.error}</p>
                  ) : (
                    <p className="text-sm italic text-stone-400 dark:text-stone-500">{t('reader.notTranslated')}</p>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
