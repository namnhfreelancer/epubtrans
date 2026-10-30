import { getProviderPreset, PROVIDER_PRESETS } from '@epubtrans/core';
import { ApiKeyField } from '../components/settings/api-key-field';
import { ModelField } from '../components/settings/model-field';
import { INPUT_CLASS } from '../components/ui/input-class';
import { Card, Field } from '../components/ui/layout-primitives';
import { useI18n } from '../i18n/i18n-context';
import { useExternalStore } from '../lib/external-store';
import { providerConfig, resolveActiveProvider } from '../lib/provider-config-store';

function hostOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : undefined;
  } catch {
    return undefined;
  }
}

export function SettingsPage() {
  const { t } = useI18n();
  const config = useExternalStore(providerConfig.store);
  const preset = getProviderPreset(config.providerId);
  const profile = config.profiles[preset.id] ?? { baseURL: '', model: '' };
  const active = resolveActiveProvider(config);
  const host = hostOf(active.baseURL);
  const baseUrlInvalid = preset.id === 'custom' && profile.baseURL.trim() !== '' && !host;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t('settings.intro')}</p>
      </div>
      <Card>
        <div className="space-y-5">
          <Field label={t('settings.provider')} htmlFor="provider">
            <select id="provider" className={INPUT_CLASS} value={preset.id} onChange={(e) => providerConfig.selectProvider(e.target.value)}>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('settings.baseUrl')}
            htmlFor="base-url"
            hint={preset.id === 'custom' ? t('settings.baseUrlHint') : undefined}
            error={baseUrlInvalid ? t('settings.baseUrlInvalid') : undefined}
          >
            <input
              id="base-url"
              type="url"
              inputMode="url"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
              placeholder="https://"
              readOnly={preset.id !== 'custom'}
              value={preset.id === 'custom' ? profile.baseURL : preset.baseURL}
              onChange={(e) => providerConfig.updateProfile(preset.id, { baseURL: e.target.value })}
            />
          </Field>
          <a
            href={preset.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-teal-700 underline underline-offset-2 dark:text-teal-400"
          >
            {t('settings.docs')}
          </a>
          <ApiKeyField providerId={preset.id} host={host} />
        </div>
      </Card>
      <Card title={t('settings.model')}>
        <ModelField
          key={`${preset.id}|${active.baseURL}`}
          active={active}
          profile={profile}
          onChange={(patch) => providerConfig.updateProfile(preset.id, patch)}
        />
      </Card>
    </div>
  );
}
