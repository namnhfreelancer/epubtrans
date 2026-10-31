import { DEFAULT_SAMPLE_PASSAGES, estimateSampleCost, MAX_SAMPLE_PASSAGES, type Project, randomSampleSeed, selectSamplePassages } from '@epubtrans/core';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { formatNumber, formatUsd } from '../../lib/format';
import { errorText } from '../../lib/notices';
import { settingsForRun } from '../../lib/provider-config-store';
import { cancelSampleJob, startSampleJob, useSampleJob } from '../../lib/sample-jobs';
import { useJobActive } from '../../lib/translation-jobs';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Alert, Card, Field, ProgressBar } from '../ui/layout-primitives';
import { SamplePassageViewer } from './sample-passage-viewer';

/** Translates a few passages from different chapters first, to judge quality before the full run. */
export function SampleTranslationCard({ project, version, provider }: { project: Project; version: number; provider: ActiveProviderState }) {
  const { t, locale } = useI18n();
  const sample = useSampleJob(project.id);
  const fullRunActive = useJobActive(project.id);
  const running = sample.status === 'running';
  const stored = project.lastSample;
  const [count, setCount] = useState(stored?.passages.length ?? DEFAULT_SAMPLE_PASSAGES);
  const [startError, setStartError] = useState<string>();

  const { providerId, baseURL, model } = provider.active;
  // The estimate covers the stored sample, or a preview selection before the first run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const estimate = useMemo(() => {
    try {
      const selection = stored ?? selectSamplePassages(project, { passages: count, seed: 0 });
      return estimateSampleCost(project, settingsForRun(project.settings, { providerId, baseURL, model }), selection);
    } catch {
      return undefined; // a book without text has nothing to sample
    }
  }, [project, stored, count, providerId, baseURL, model, version]);

  const start = (request: Parameters<typeof startSampleJob>[3]) => {
    setStartError(undefined);
    if (provider.problem) return setStartError(t(provider.problem));
    try {
      const { provider: chat, settings } = provider.prepare(project);
      startSampleJob(project, settings, chat, request);
    } catch (err) {
      setStartError(errorText(err));
    }
  };
  const newSample = () => start({ passages: count, seed: randomSampleSeed() });
  const locked = running || fullRunActive;
  const lockedHint = fullRunActive ? t('sample.lockedByRun') : undefined;
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
                <Button variant="primary" data-testid="sample-again" disabled={locked} onClick={() => start({ selection: stored })}>
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
        {startError && <Alert kind="error">{startError}</Alert>}
        {!running && sample.status === 'failed' && <Alert kind="error">{t('sample.failed', { message: sample.error ?? '' })}</Alert>}
        {!running && sample.status === 'cancelled' && <Alert>{t('sample.cancelled')}</Alert>}
        {!running && sample.status === 'done' && (
          <Alert kind="success">
            <span data-testid="sample-complete">{t('sample.done')}</span>
          </Alert>
        )}
      </div>
      {stored && <SamplePassageViewer project={project} selection={stored} />}
    </Card>
  );
}
