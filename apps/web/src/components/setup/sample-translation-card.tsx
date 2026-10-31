import { DEFAULT_SAMPLE_PASSAGES, MAX_SAMPLE_PASSAGES, type Project, randomSampleSeed } from '@epubtrans/core';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { refreshJobLocks, useJobRunningElsewhere } from '../../lib/cross-tab-job-lock';
import { formatNumber, formatUsd } from '../../lib/format';
import { useHintsRunning } from '../../lib/hint-jobs';
import { errorText } from '../../lib/notices';
import { cancelSampleJob, startSampleJob, useSampleJob } from '../../lib/sample-jobs';
import { useJobActive } from '../../lib/translation-jobs';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { useSampleEstimate } from '../../lib/use-sample-estimate';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Alert, Card, Field, ProgressBar } from '../ui/layout-primitives';
import { SamplePassageViewer } from './sample-passage-viewer';

/** Translates a few passages from different chapters first, to judge quality before the full run. */
export function SampleTranslationCard({ project, version, provider }: { project: Project; version: number; provider: ActiveProviderState }) {
  const { t, locale } = useI18n();
  const sample = useSampleJob(project.id);
  const fullRunActive = useJobActive(project.id);
  const hintsRunning = useHintsRunning(project.id);
  const running = sample.status === 'running';
  // A sample run holds the same cross-tab job lock as the full run: blocked while another tab translates the book.
  const busyElsewhere = useJobRunningElsewhere(project.id) && !running;
  const stored = project.lastSample;
  const [count, setCount] = useState(stored?.passages.length ?? DEFAULT_SAMPLE_PASSAGES);
  const [startError, setStartError] = useState<string>();

  // The estimate covers the stored sample, or a preview selection before the first run.
  const estimate = useSampleEstimate({ project, version, provider: provider.active, stored, passages: count, paused: running || fullRunActive });
  // Labels for the viewer, from the last finished run (cleared when the next one starts).
  const failedIds = useMemo(() => new Set(sample.failed), [sample.failed]);
  const finished = sample.status === 'done' || sample.status === 'failed';

  const start = async (request: Parameters<typeof startSampleJob>[3]) => {
    setStartError(undefined);
    if (provider.problem) return setStartError(t(provider.problem));
    try {
      const { provider: chat, settings } = provider.prepare(project);
      // Another tab won the lock before this one noticed: re-read the locks so the busy notice shows right away.
      if ((await startSampleJob(project, settings, chat, request)) === 'busy-elsewhere') await refreshJobLocks();
    } catch (err) {
      setStartError(errorText(err));
    }
  };
  const newSample = () => void start({ passages: count, seed: randomSampleSeed() });
  const locked = running || fullRunActive || hintsRunning || busyElsewhere;
  const lockedHint = fullRunActive ? t('sample.lockedByRun') : hintsRunning ? t('hints.blocksRun') : busyElsewhere ? t('run.busyElsewhere') : undefined;
  const usd = estimate?.usd;

  return (
    <Card title={t('sample.title')} actions={running && <Button onClick={() => cancelSampleJob(project.id)}>{t('sample.cancel')}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('sample.intro')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label={t('sample.passages')} htmlFor="sample-passages" hint={t('sample.passagesHint')}>
              <input
                id="sample-passages"
                type="number"
                min={1}
                max={MAX_SAMPLE_PASSAGES}
                step={1}
                inputMode="numeric"
                className={INPUT_CLASS}
                value={count}
                disabled={locked}
                onChange={(e) => setCount(Math.min(MAX_SAMPLE_PASSAGES, Math.max(1, Math.floor(Number(e.target.value)) || 1)))}
              />
            </Field>
          </div>
          <span className="flex flex-wrap gap-2" title={lockedHint}>
            {stored ? (
              <>
                <Button variant="primary" data-testid="sample-again" disabled={locked} onClick={() => void start({ selection: stored })}>
                  {t('sample.again')}
                </Button>
                <Button data-testid="sample-new" disabled={locked} onClick={newSample}>
                  {t('sample.new')}
                </Button>
              </>
            ) : (
              <Button variant="primary" data-testid="sample-translate" disabled={locked} onClick={newSample}>
                {t('sample.translate')}
              </Button>
            )}
          </span>
        </div>
        {estimate && estimate.inputTokens > 0 && (
          <p data-testid="sample-estimate" className="text-xs text-stone-500 dark:text-stone-400">
            {t('sample.estimate', { input: formatNumber(estimate.inputTokens, locale), output: formatNumber(estimate.outputTokens, locale) })}
            {usd !== undefined && ` · ${t('sample.estimateUsd', { usd: formatUsd(usd, locale) })}`}
          </p>
        )}
        {running && (
          <>
            <ProgressBar value={sample.done} max={sample.total} label={t('sample.title')} />
            <p data-testid="sample-progress" className="text-sm text-stone-600 dark:text-stone-400">
              {t('sample.running', { done: formatNumber(sample.done, locale), total: formatNumber(sample.total, locale) })}
            </p>
          </>
        )}
        {busyElsewhere && (
          <Alert>
            <span data-testid="sample-busy-elsewhere">{t('run.busyElsewhere')}</span>
          </Alert>
        )}
        {startError && <Alert kind="error">{startError}</Alert>}
        {sample.status === 'failed' &&
          (sample.error !== undefined ? (
            <Alert kind="error">{t('sample.failed', { message: sample.error })}</Alert>
          ) : (
            <Alert kind="error">
              <span data-testid="sample-all-failed">{t('sample.allFailed', { n: formatNumber(sample.failed.length, locale) })}</span>
            </Alert>
          ))}
        {sample.status === 'cancelled' && <Alert>{t('sample.cancelled')}</Alert>}
        {sample.status === 'done' && (
          <Alert kind={sample.failed.length > 0 ? 'warning' : 'success'}>
            {sample.failed.length > 0 ? (
              <span data-testid="sample-partly-failed">{t('sample.someFailed', { n: formatNumber(sample.failed.length, locale) })}</span>
            ) : (
              <span data-testid="sample-complete">{t('sample.done')}</span>
            )}
            {sample.keptEdited.length > 0 && (
              <span data-testid="sample-kept-edited"> {t('sample.keptEdited', { n: formatNumber(sample.keptEdited.length, locale) })}</span>
            )}
          </Alert>
        )}
      </div>
      {stored && <SamplePassageViewer project={project} selection={stored} failed={finished ? failedIds : undefined} />}
    </Card>
  );
}
