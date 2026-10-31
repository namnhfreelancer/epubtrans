import type { Project, SampleSelection, Segment } from '@epubtrans/core';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import type { MessageKey } from '../../i18n/messages-en';
import { SegmentText } from '../reader/segment-row';

const BADGE_STYLES = {
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  edited: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
} as const;

function Badge({ kind, children }: { kind: keyof typeof BADGE_STYLES; children: ReactNode }) {
  return (
    <span data-testid={`sample-badge-${kind}`} className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLES[kind]}`}>
      {children}
    </span>
  );
}

/** Why the segment does not show this run's answer, if it does not: the run failed for it, or it was edited by hand. */
function badgeOf(segment: Segment, failed: ReadonlySet<string> | undefined): { kind: keyof typeof BADGE_STYLES; label: MessageKey } | undefined {
  // A hand edit is never resampled (also after a failed run that skipped it), so that label wins.
  if (segment.userEdited && segment.translationHtml !== undefined) return { kind: 'edited', label: 'sample.badgeEdited' };
  if (!failed?.has(segment.id)) return undefined;
  return { kind: 'failed', label: segment.status === 'error' ? 'sample.badgeFailed' : 'sample.badgeFailedKept' };
}

/**
 * The sampled passages, one block per chapter, with every segment as a source / translation pair. `failed` lists the
 * segments the last finished sample run could not translate; they and hand-edited segments are labelled.
 */
export function SamplePassageViewer({ project, selection, failed }: { project: Project; selection: SampleSelection; failed?: ReadonlySet<string> }) {
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
            const badge = badgeOf(segment, failed);
            return (
              <article
                key={id}
                data-testid="sample-segment"
                data-segment-id={id}
                className="grid gap-3 border-b border-stone-200 py-3 last:border-b-0 md:grid-cols-2 md:gap-6 dark:border-stone-800"
              >
                <SegmentText html={segment.sourceHtml} lang={sourceLang === 'auto' ? undefined : sourceLang} />
                <div data-testid="sample-translation">
                  {badge && <Badge kind={badge.kind}>{t(badge.label)}</Badge>}
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
