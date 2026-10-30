import { detectLanguage, getProviderPreset, MAX_CONCURRENCY, type Project } from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { routeHref } from '../../lib/hash-route';
import { languageLabel } from '../../lib/languages';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-store';
import type { ActiveProvider } from '../../lib/provider-config-store';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Card, Field } from '../ui/layout-primitives';
import { LanguageInput } from './language-input';

/** Language pair, concurrency, two-pass toggle and the provider/model used for this book. */
export function LanguageOptionsCard({ project, active }: { project: Project; active: ActiveProvider }) {
  const { t, locale } = useI18n();
  const [detected, setDetected] = useState<string>();
  const settings = project.settings;
  const save = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));

  const detect = () => {
    const lang = detectLanguage(project);
    setDetected(lang === 'und' ? t('setup.detectFailed') : t('setup.detected', { lang: `${languageLabel(lang, locale)} (${lang})` }));
    if (lang !== 'und') void save({ sourceLang: lang });
  };

  return (
    <Card title={t('setup.languages')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <LanguageInput id="source-lang" label={t('setup.source')} value={settings.sourceLang} allowAuto onCommit={(tag) => void save({ sourceLang: tag })} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={detect}>
              {t('setup.detect')}
            </Button>
            {detected && <span className="text-xs text-stone-500 dark:text-stone-400">{detected}</span>}
          </div>
        </div>
        <LanguageInput id="target-lang" label={t('setup.target')} value={settings.targetLang} onCommit={(tag) => void save({ targetLang: tag })} />
        <Field label={t('setup.concurrency')} htmlFor="concurrency" hint={t('setup.concurrencyHint')}>
          <input
            id="concurrency"
            type="number"
            min={1}
            max={MAX_CONCURRENCY}
            className={INPUT_CLASS}
            defaultValue={settings.concurrency}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n) && n >= 1 && n <= MAX_CONCURRENCY) void save({ concurrency: n });
            }}
          />
        </Field>
        <label className="flex items-start gap-2 self-center text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-teal-700"
            checked={settings.twoPass}
            onChange={(e) => void save({ twoPass: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('setup.twoPass')}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400">{t('setup.twoPassHint')}</span>
          </span>
        </label>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 text-sm text-stone-600 dark:text-stone-400">
        <span data-testid="provider-summary">
          {t('setup.provider', { provider: getProviderPreset(active.providerId).label, model: active.model || t('setup.noModel') })}
        </span>
        <a href={routeHref({ name: 'settings' })} className="text-teal-700 underline underline-offset-2 dark:text-teal-400">
          {t('setup.changeProvider')}
        </a>
      </p>
    </Card>
  );
}
