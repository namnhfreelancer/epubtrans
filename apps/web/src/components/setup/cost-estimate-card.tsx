import { estimateCost, type Project } from '@epubtrans/core';
import { useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { formatNumber, formatUsd, parseOptionalPrice } from '../../lib/format';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-store';
import { type ActiveProvider, settingsForRun } from '../../lib/provider-config-store';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Card, Field } from '../ui/layout-primitives';

/** Prices per 1M tokens and the token/cost estimate for the remaining work. */
export function CostEstimateCard({ project, version, active }: { project: Project; version: number; active: ActiveProvider }) {
  const { t, locale } = useI18n();
  const settings = project.settings;
  const published = active.priceInPerM !== undefined && active.priceOutPerM !== undefined;
  const save = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));

  // Prefill once per model when the provider publishes prices (OpenRouter) and the book has none yet.
  const prefilledFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = `${project.id}|${active.providerId}|${active.model}`;
    if (!published || prefilledFor.current === key) return;
    prefilledFor.current = key;
    if (project.settings.priceInPerM === undefined && project.settings.priceOutPerM === undefined) {
      void updateSettings(project, { priceInPerM: active.priceInPerM, priceOutPerM: active.priceOutPerM }).catch(() => undefined);
    }
  }, [project, published, active.providerId, active.model, active.priceInPerM, active.priceOutPerM]);

  const { providerId, baseURL, model } = active;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const estimate = useMemo(
    () => estimateCost(project, settingsForRun(settings, { providerId, baseURL, model })),
    [project, settings, providerId, baseURL, model, version],
  );

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
            onBlur={(e) => void save({ priceOutPerM: parseOptionalPrice(e.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <span>{t('setup.priceHint')}</span>
        {published && (
          <Button size="sm" variant="ghost" onClick={() => void save({ priceInPerM: active.priceInPerM, priceOutPerM: active.priceOutPerM })}>
            {t('setup.usePublished')}
          </Button>
        )}
      </div>
      <div data-testid="cost-estimate" className="mt-4 rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800">
        {estimate.inputTokens === 0 ? (
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
      </div>
    </Card>
  );
}
