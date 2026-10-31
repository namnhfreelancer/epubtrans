import type { Project } from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';
import { formatNumber, formatUsd, parseOptionalPrice } from '../../lib/format';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-store';
import type { ActiveProvider } from '../../lib/provider-config-store';
import { estimateRunCost } from '../../lib/run-pricing';
import { useSampleRunning } from '../../lib/sample-jobs';
import { useJobActive } from '../../lib/translation-jobs';
import { useCostEstimate } from '../../lib/use-cost-estimate';
import { useRunPrices } from '../../lib/use-run-prices';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Card, Field } from '../ui/layout-primitives';

const SOURCE_LABELS = { openrouter: 'OpenRouter', litellm: 'LiteLLM' } as const;

/** Prices per 1M tokens and the token/cost estimate for the remaining work. */
export function CostEstimateCard({ project, version, active }: { project: Project; version: number; active: ActiveProvider }) {
  const { t, locale } = useI18n();
  const settings = project.settings;
  const save = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));

  const { priceInPerM, priceOutPerM, auto, published, manual, lookup } = useRunPrices(settings, active);

  const { providerId, baseURL, model } = active;
  // The estimate walks every batch of the book, while `version` changes on every finished segment and every keystroke
  // in the guideline or glossary: recompute debounced and off the critical path, and not at all during a run.
  const runActive = useJobActive(project.id);
  const sampleRunning = useSampleRunning(project.id);
  const { estimate, deferred } = useCostEstimate(
    () => estimateRunCost(project, { providerId, baseURL, model }, { priceInPerM, priceOutPerM }),
    runActive || sampleRunning,
    // `version` tracks in-place project mutations.
    [project, settings, providerId, baseURL, model, priceInPerM, priceOutPerM, version],
  );

  const sourceNote = published
    ? t('setup.priceFromProvider')
    : lookup.status === 'found'
      ? t('setup.priceFound', { source: SOURCE_LABELS[lookup.pricing.source], id: lookup.pricing.matchedId })
      : lookup.status === 'loading'
        ? t('setup.priceLooking')
        : lookup.status === 'none'
          ? t('setup.priceNone')
          : undefined;

  return (
    <Card title={t('setup.cost')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('setup.priceIn')} htmlFor="price-in">
          <input
            key={`in-${settings.priceInPerM ?? ''}`}
            id="price-in"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className={INPUT_CLASS}
            defaultValue={settings.priceInPerM ?? ''}
            placeholder={auto?.priceInPerM?.toString() ?? ''}
            onBlur={(e) => void save({ priceInPerM: parseOptionalPrice(e.target.value) })}
          />
        </Field>
        <Field label={t('setup.priceOut')} htmlFor="price-out">
          <input
            key={`out-${settings.priceOutPerM ?? ''}`}
            id="price-out"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className={INPUT_CLASS}
            defaultValue={settings.priceOutPerM ?? ''}
            placeholder={auto?.priceOutPerM?.toString() ?? ''}
            onBlur={(e) => void save({ priceOutPerM: parseOptionalPrice(e.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <span data-testid="price-source">
          {[sourceNote, manual && auto ? t('setup.priceManualWins') : undefined].filter(Boolean).join(' ') || t('setup.priceHint')}
        </span>
        {manual && auto && (
          <Button size="sm" variant="ghost" onClick={() => void save({ priceInPerM: undefined, priceOutPerM: undefined })}>
            {t('setup.usePublished')}
          </Button>
        )}
      </div>
      <div data-testid="cost-estimate" className="mt-4 rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800">
        {estimate === undefined ? (
          <p data-testid="estimate-calculating" className="text-sm text-stone-500 dark:text-stone-400">
            {t('setup.estimateCalculating')}
          </p>
        ) : estimate.inputTokens === 0 ? (
          <p className="text-sm">{t('setup.estimateNothing')}</p>
        ) : (
          <>
            <p className="text-sm font-medium">
              {t('setup.estimateTokens', { input: formatNumber(estimate.inputTokens, locale), output: formatNumber(estimate.outputTokens, locale) })}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {estimate.usd !== undefined ? (
                t('setup.estimateUsd', { usd: formatUsd(estimate.usd, locale) })
              ) : (
                <span className="text-sm font-normal">{t('setup.estimateNoPrice')}</span>
              )}
            </p>
          </>
        )}
        {deferred && (
          <p data-testid="estimate-deferred" className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {t('setup.estimateUpdatesAfterRun')}
          </p>
        )}
      </div>
    </Card>
  );
}
