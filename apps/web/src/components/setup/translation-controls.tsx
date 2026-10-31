import type { Project } from '@epubtrans/core';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { formatDuration, formatNumber } from '../../lib/format';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-store';
import { useSampleRunning } from '../../lib/sample-jobs';
import { countSegments, remainingWork } from '../../lib/segment-counts';
import { estimateRemainingMs, pauseJob, startJob, useJob } from '../../lib/translation-jobs';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { Button } from '../ui/button';
import { Alert, Card, ProgressBar } from '../ui/layout-primitives';

/** Start / pause / resume, progress, ETA and failed-segment retry for one book. */
export function TranslationControls({ project, version, provider }: { project: Project; version: number; provider: ActiveProviderState }) {
  const { t, locale } = useI18n();
  const job = useJob(project.id);
  const [startError, setStartError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const running = job.status === 'running' || job.status === 'pausing';
  const sampleRunning = useSampleRunning(project.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const counts = useMemo(() => countSegments(project), [project, version]);
  const work = remainingWork(counts, project.settings.twoPass);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const start = () => {
    setStartError(undefined);
    if (provider.problem) return setStartError(t(provider.problem));
    try {
      const { provider: chat, settings } = provider.prepare(project);
      startJob(project, settings, chat);
      // Remember which provider/model translated the book (carried in the project file, e.g. for CLI resume).
      const { providerId, baseURL, model } = settings;
      void updateSettings(project, { providerId, baseURL, model }).catch((err: unknown) =>
        pushNotice('error', t('common.saveFailed', { message: errorText(err) })),
      );
    } catch (err) {
      setStartError(errorText(err));
    }
  };

  const eta = running ? estimateRemainingMs(job, now) : undefined;
  const label = counts.done > 0 || counts.error > 0 ? (counts.pending === 0 && counts.error > 0 ? t('run.retryFailed') : t('run.resume')) : t('run.start');

  return (
    <Card
      title={t('run.title')}
      actions={
        running ? (
          <Button onClick={() => pauseJob(project.id)} disabled={job.status === 'pausing'}>
            {job.status === 'pausing' ? t('run.pausing') : t('run.pause')}
          </Button>
        ) : (
          work > 0 && (
            <Button
              variant="primary"
              data-testid="start-translation"
              onClick={start}
              disabled={sampleRunning}
              title={sampleRunning ? t('sample.blocksRun') : undefined}
            >
              {label}
            </Button>
          )
        )
      }
    >
      <div className="space-y-3">
        <ProgressBar value={counts.done} max={counts.total} label={t('run.title')} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
          <span data-testid="run-progress">{t('run.progress', { done: formatNumber(counts.done, locale), total: formatNumber(counts.total, locale) })}</span>
          {running && (
            <span>
              {t(`run.phase.${job.phase}`)} {formatNumber(job.done, locale)}/{formatNumber(job.total, locale)}
              {eta !== undefined && ` · ${t('run.eta', { time: formatDuration(eta, locale) })}`}
            </span>
          )}
          {counts.error > 0 && (
            <span data-testid="run-errors" className="text-red-700 dark:text-red-400">
              {t('run.errors', { n: counts.error })}
            </span>
          )}
          {(job.usage.input > 0 || job.usage.output > 0) && (
            <span>{t('run.usage', { input: formatNumber(job.usage.input, locale), output: formatNumber(job.usage.output, locale) })}</span>
          )}
        </div>
        {startError && <Alert kind="error">{startError}</Alert>}
        {!running && job.status === 'failed' && job.error && <Alert kind="error">{t('run.failed', { message: job.error })}</Alert>}
        {!running && job.status === 'paused' && <Alert>{t('run.paused')}</Alert>}
        {!running && work === 0 && (
          <Alert kind="success">
            <span data-testid="run-complete">{job.status === 'done' ? t('run.done') : t('run.allDone')}</span>
          </Alert>
        )}
      </div>
    </Card>
  );
}
