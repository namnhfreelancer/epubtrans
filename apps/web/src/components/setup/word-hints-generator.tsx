import type { FrequencyList, Project } from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { refreshJobLocks, useJobRunningElsewhere } from '../../lib/cross-tab-job-lock';
import { formatNumber, formatUsd } from '../../lib/format';
import { cancelHintJob, startHintJob, useHintJob } from '../../lib/hint-jobs';
import { errorText } from '../../lib/notices';
import { useSampleRunning } from '../../lib/sample-jobs';
import { useJobActive } from '../../lib/translation-jobs';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { useCostEstimate } from '../../lib/use-cost-estimate';
import { useRunPrices } from '../../lib/use-run-prices';
import { computeWordHintsPlan, planForRun } from '../../lib/word-hints-plan-cache';
import { Button } from '../ui/button';
import { Alert, ProgressBar } from '../ui/layout-primitives';

/**
 * Plans the hints run locally (candidate words at the current level that have no gloss yet), shows its token and
 * cost estimate, and runs it as a job under the book's job lock. Finished words are saved as they arrive, so a
 * reload or a cancel loses nothing and the next run only sends what is missing.
 */
export function WordHintsGenerator({
  project,
  version,
  provider,
  list,
}: {
  project: Project;
  version: number;
  provider: ActiveProviderState;
  list: FrequencyList;
}) {
  const { t, locale } = useI18n();
  const job = useHintJob(project.id);
  const running = job.status === 'running';
  const translating = useJobActive(project.id);
  const sampling = useSampleRunning(project.id);
  const busyElsewhere = useJobRunningElsewhere(project.id) && !running;
  const [startError, setStartError] = useState<string>();
  const prices = useRunPrices(project.settings, provider.active);
  const { priceInPerM, priceOutPerM } = prices;

  // Selecting candidates scans the whole book and `version` changes on every finished word or segment, so the plan
  // and its estimate are scheduled like the book estimate: debounced, when idle, and kept as they are during a run.
  // Generate reuses this plan while it is current, so a click never rescans the book.
  const { estimate: planned } = useCostEstimate(
    () => computeWordHintsPlan(project, list, version, { priceInPerM, priceOutPerM }),
    running || translating || sampling,
    // `version` tracks in-place project mutations (settings, new hints).
    [project, list, priceInPerM, priceOutPerM, version],
  );
  const pending = planned?.plan.candidates.length ?? 0;
  const glossed = planned && !planned.plan.reset ? (project.wordHints?.entries.length ?? 0) : 0;
  const locked = running || translating || sampling || busyElsewhere;

  const start = async () => {
    setStartError(undefined);
    if (provider.problem) return setStartError(t(provider.problem));
    try {
      const { provider: chat, settings } = provider.prepare(project);
      // A stale plan (another tab added hints since it was computed) is replaced by one from the current state.
      const plan = planForRun(planned, project, list, settings, version);
      if ((await startHintJob(project, plan, settings, chat)) === 'busy-elsewhere') await refreshJobLocks();
    } catch (err) {
      setStartError(errorText(err));
    }
  };

  return (
    <div className="space-y-3 rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800">
      {planned === undefined ? (
        <p data-testid="hints-calculating" className="text-sm text-stone-500 dark:text-stone-400">
          {t('setup.estimateCalculating')}
        </p>
      ) : (
        <>
          <p data-testid="hints-status" className="text-sm">
            {pending === 0
              ? t('hints.statusAllDone', { total: formatNumber(planned.plan.total, locale) })
              : t('hints.status', { glossed: formatNumber(glossed, locale), pending: formatNumber(pending, locale) })}
          </p>
          {planned.plan.reset && <Alert kind="warning">{t('hints.otherPair')}</Alert>}
          {pending > 0 && (
            <p data-testid="hints-estimate" className="text-xs text-stone-600 dark:text-stone-300">
              {t('hints.estimate', {
                input: formatNumber(planned.estimate.inputTokens, locale),
                output: formatNumber(planned.estimate.outputTokens, locale),
                words: formatNumber(planned.estimate.words, locale),
              })}
              {planned.estimate.usd !== undefined && ` · ${t('hints.estimateUsd', { usd: formatUsd(planned.estimate.usd, locale) })}`}
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2" title={translating || sampling ? t('hints.lockedByJob') : busyElsewhere ? t('run.busyElsewhere') : undefined}>
        {running ? (
          <Button onClick={() => cancelHintJob(project.id)}>{t('hints.cancel')}</Button>
        ) : (
          <Button variant="primary" data-testid="hints-generate" disabled={locked || pending === 0} onClick={() => void start()}>
            {t('hints.generate')}
          </Button>
        )}
      </div>
      {running && (
        <>
          <ProgressBar value={job.done} max={job.total} label={t('hints.title')} />
          <p data-testid="hints-progress" className="text-sm text-stone-600 dark:text-stone-400">
            {t('hints.running', { done: formatNumber(job.done, locale), total: formatNumber(job.total, locale) })}
          </p>
        </>
      )}
      {busyElsewhere && <Alert>{t('run.busyElsewhere')}</Alert>}
      {startError && <Alert kind="error">{startError}</Alert>}
      {!running && job.status === 'failed' && job.settingsChanged && (
        <Alert kind="warning">
          <span data-testid="hints-settings-changed">{t('hints.settingsChanged')}</span>
        </Alert>
      )}
      {!running && job.status === 'failed' && !job.settingsChanged && <Alert kind="error">{t('hints.failed', { message: job.error ?? '' })}</Alert>}
      {!running && job.status === 'cancelled' && <Alert>{t('hints.cancelled')}</Alert>}
      {!running && job.status === 'done' && (
        <Alert kind={job.failed > 0 ? 'warning' : 'success'}>
          <span data-testid="hints-complete">{job.failed > 0 ? t('hints.doneFailed', { n: job.failed }) : t('hints.done')}</span>
        </Alert>
      )}
    </div>
  );
}
