import { type Project, retranslateSegment, type Segment } from '@epubtrans/core';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { useJobRunningElsewhere } from '../../lib/cross-tab-job-lock';
import { errorText, pushNotice } from '../../lib/notices';
import { persistSegment, saveTranslationEdit, touchProject } from '../../lib/project-store';
import { sanitizeSegmentHtml } from '../../lib/sanitize-segment-html';
import { segmentErrorText } from '../../lib/segment-error-text';
import { useJobActive } from '../../lib/translation-jobs';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { StatusBadge } from './status-badge';

export type ReaderMode = 'side' | 'interleaved';

interface SegmentRowProps {
  project: Project;
  segment: Segment;
  mode: ReaderMode;
  provider: ActiveProviderState;
  /** Briefly emphasise the row (after jumping to it from the error navigation). */
  flash?: boolean;
}

export function SegmentText({ html, lang, faded = false }: { html: string; lang?: string; faded?: boolean }) {
  return (
    <div
      lang={lang}
      className={`reading-text break-words ${faded ? 'text-stone-500 dark:text-stone-400' : ''}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markup is reduced to attribute-free inline formatting by sanitizeSegmentHtml.
      dangerouslySetInnerHTML={{ __html: sanitizeSegmentHtml(html) }}
    />
  );
}

/** One source/translation pair with inline editing (saved on blur) and per-segment retranslation. */
export function SegmentRow({ project, segment, mode, provider, flash = false }: SegmentRowProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const { sourceLang, targetLang } = project.settings;
  // A running job (in this tab or another one) would race a manual edit or retranslation of the same segment.
  const jobHere = useJobActive(project.id);
  const jobElsewhere = useJobRunningElsewhere(project.id);
  const jobActive = jobHere || jobElsewhere;
  const lockedHint = jobHere ? t('reader.lockedDuringJob') : jobElsewhere ? t('reader.lockedInOtherTab') : undefined;

  useEffect(() => () => abortRef.current?.abort(), []);
  // A failed retranslation message is stale once the segment got a new translation or status (e.g. from "Retry all failed").
  // biome-ignore lint/correctness/useExhaustiveDependencies: the segment is mutated in place; its status and text are the triggers.
  useEffect(() => setRowError(undefined), [segment.status, segment.translationHtml]);

  const saveEdit = (value: string) => {
    setEditing(false);
    saveTranslationEdit(project, segment, value).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));
  };

  const retranslate = async () => {
    setRowError(undefined);
    if (provider.problem) return setRowError(t(provider.problem));
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const { provider: chat, settings } = provider.prepare(project);
      const updated = await retranslateSegment(project, segment.id, chat, settings, controller.signal);
      touchProject(project.id);
      await persistSegment(project.id, updated);
    } catch (err) {
      if (!controller.signal.aborted) setRowError(t('reader.retranslateFailed', { message: segmentErrorText(errorText(err)) ?? errorText(err) }));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const translation = editing ? (
    <div className="space-y-1">
      <label htmlFor={`edit-${segment.id}`} className="sr-only">
        {t('reader.editLabel')}
      </label>
      <textarea
        id={`edit-${segment.id}`}
        data-testid="segment-editor"
        // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit "Edit" click.
        autoFocus
        rows={Math.min(14, Math.max(3, Math.ceil((segment.translationHtml ?? '').length / 70)))}
        className={`${INPUT_CLASS} font-mono text-xs leading-relaxed`}
        defaultValue={segment.translationHtml ?? ''}
        onBlur={(e) => saveEdit(e.target.value)}
      />
      <p className="text-[11px] text-stone-500 dark:text-stone-400">{t('reader.editHint')}</p>
    </div>
  ) : segment.translationHtml ? (
    <SegmentText html={segment.translationHtml} lang={targetLang} />
  ) : (
    <p className="text-sm italic text-stone-400 dark:text-stone-500">{t('reader.notTranslated')}</p>
  );

  // The freshest failure wins; the stored one (from a batch run) is shown only when no retranslation just failed.
  const failure = rowError ?? segmentErrorText(segment.error);
  const failed = segment.status === 'error';

  return (
    <article
      data-testid="segment-row"
      data-segment-id={segment.id}
      data-status={segment.status}
      data-flash={flash || undefined}
      tabIndex={-1}
      className={`group border-b border-stone-200 py-4 outline-offset-2 last:border-b-0 focus-visible:outline-2 focus-visible:outline-teal-600 dark:border-stone-800 ${
        failed ? 'border-l-4 border-l-red-500 pl-3' : ''
      } ${flash ? 'segment-flash' : ''}`}
    >
      <div className={mode === 'side' ? 'grid gap-3 md:grid-cols-2 md:gap-6' : 'space-y-2'}>
        <SegmentText html={segment.sourceHtml} lang={sourceLang === 'auto' ? undefined : sourceLang} faded={mode === 'interleaved'} />
        <div data-testid="segment-translation">{translation}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={segment.status} />
        <span className="ml-auto flex gap-1" title={lockedHint}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={editing || jobActive} title={lockedHint}>
            {t('reader.edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void retranslate()} disabled={busy || jobActive} title={lockedHint}>
            {busy ? t('reader.retranslating') : t('reader.retranslate')}
          </Button>
        </span>
      </div>
      {failure && (
        <p
          data-testid="segment-error"
          role={rowError ? 'alert' : undefined}
          className="mt-1.5 whitespace-pre-wrap break-words text-xs text-red-700 dark:text-red-400"
        >
          {failure}
        </p>
      )}
    </article>
  );
}
