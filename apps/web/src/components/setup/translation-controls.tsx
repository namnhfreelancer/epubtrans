import { type Project, usageCostUsd } from '@epubtrans/core';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { formatDuration, formatNumber, formatUsd } from '../../lib/format';
import { useHintsRunning } from '../../lib/hint-jobs';
import { localizedError } from '../../lib/notices';
import { type RunPrices, resolveRunPrices } from '../../lib/run-pricing';
import { useSampleRunning } from '../../lib/sample-jobs';
import { countSegments, remainingWork } from '../../lib/segment-counts';
import { estimateRemainingMs, pauseJob, useJob } from '../../lib/translation-jobs';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import type { ModelPricingState } from '../../lib/use-model-pricing';
import { useStartTranslation } from '../../lib/use-start-translation';
import { Button } from '../ui/button';
import { Alert, Card, ProgressBar } from '../ui/layout-primitives';

const pickPrices = ({ priceInPerM, priceOutPerM }: RunPrices) => ({ priceInPerM, priceOutPerM });

/** Start / pause / resume, progress, ETA and failed-segment retry for one book. */
export function TranslationControls({
  project,
  version,
  provider,
  lookup,
}: {
  project: Project;
  version: number;
  provider: ActiveProviderState;
  /** Public catalog price of the active model (looked up once by the setup panel). */
  lookup: ModelPricingState;
}) {
  const { t, locale } = useI18n();
  const job = useJob(project.id);
  const [now, setNow] = useState(Date.now());
  const running = job.status === 'running' || job.status === 'pausing';
  const sampleRunning = useSampleRunning(project.id);
  const hintsRunning = useHintsRunning(project.id);
  // Only one tab may translate a book at a time (cross-tab job lock).
  const { start, error: startError, busyElsewhere } = useStartTranslation(project, provider);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const counts = useMemo(() => countSegments(project), [project, version]);
  const work = remainingWork(counts, project.settings.twoPass);
  // Cost of the tokens this run used, at the prices the cost card resolves (cached input at its discount).
  const prices = resolveRunPrices(project.settings, provider.active, lookup.status === 'found' ? lookup.pricing : undefined);
  const usageUsd = usageCostUsd(job.usage, { ...project.settings, providerId: provider.active.providerId, ...pickPrices(prices) });

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

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
              onClick={() => void start()}
              disabled={sampleRunning || hintsRunning || busyElsewhere}
              title={sampleRunning ? t('sample.blocksRun') : hintsRunning ? t('hints.blocksRun') : busyElsewhere ? t('run.busyElsewhere') : undefined}
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
            <span data-testid="run-usage">
              {job.usage.cachedInput
                ? t('run.usageCached', {
                    input: formatNumber(job.usage.input, locale),
                    cached: formatNumber(job.usage.cachedInput, locale),
                    output: formatNumber(job.usage.output, locale),
                  })
                : t('run.usage', { input: formatNumber(job.usage.input, locale), output: formatNumber(job.usage.output, locale) })}
              {usageUsd !== undefined && ` · ${t('run.usageCost', { usd: formatUsd(usageUsd, locale) })}`}
            </span>
          )}
        </div>
        {busyElsewhere && (
          <Alert>
            <span data-testid="run-busy-elsewhere">{t('run.busyElsewhere')}</span>
          </Alert>
        )}
        {startError && <Alert kind="error">{startError}</Alert>}
        {!running && job.status === 'failed' && job.error && <Alert kind="error">{t('run.failed', { message: localizedError(job.error, t) })}</Alert>}
        {!running && job.status === 'aborted' && (
          <Alert kind="error">
            <span data-testid="run-book-deleted">{t('run.bookDeleted')}</span>
          </Alert>
        )}
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
