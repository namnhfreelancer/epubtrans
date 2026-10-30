import type { ModelInfo } from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { apiKeys } from '../../lib/api-key-store';
import { formatUsd } from '../../lib/format';
import { errorText } from '../../lib/notices';
import { type ActiveProvider, buildProvider, type ProviderProfile } from '../../lib/provider-config-store';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Alert, Field } from '../ui/layout-primitives';

type Status = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; count: number } | { kind: 'error'; message: string };

interface ModelFieldProps {
  active: ActiveProvider;
  profile: ProviderProfile;
  onChange: (patch: Partial<ProviderProfile>) => void;
}

/** "Test connection" lists models from the provider; a free-text model id is always available. */
export function ModelField({ active, profile, onChange }: ModelFieldProps) {
  const { t, locale } = useI18n();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const test = async () => {
    const key = apiKeys.getKey(active.providerId);
    if (!key && active.providerId !== 'custom') return setStatus({ kind: 'error', message: t('settings.needKey') });
    setStatus({ kind: 'testing' });
    try {
      const provider = buildProvider(active, key);
      const list = provider.listModelInfo ? await provider.listModelInfo() : (await provider.listModels()).map((id) => ({ id }));
      setModels(list);
      setStatus({ kind: 'ok', count: list.length });
    } catch (err) {
      setStatus({ kind: 'error', message: errorText(err) });
    }
  };

  const choose = (id: string) => {
    const info = models.find((m) => m.id === id);
    onChange({ model: id, priceInPerM: info?.priceInPerM, priceOutPerM: info?.priceOutPerM });
  };

  const selected = models.find((m) => m.id === profile.model);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void test()} disabled={status.kind === 'testing'}>
          {status.kind === 'testing' ? t('settings.testing') : t('settings.test')}
        </Button>
        {status.kind === 'ok' && (
          <span data-testid="connection-status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {t('settings.connected', { n: status.count })}
          </span>
        )}
      </div>
      {status.kind === 'error' && (
        <Alert kind="error">
          <span data-testid="connection-error">{t('settings.connectionFailed', { message: status.message })}</span>
        </Alert>
      )}
      {models.length > 0 && (
        <Field label={t('settings.modelList')} htmlFor="model-select">
          <select id="model-select" className={INPUT_CLASS} value={selected ? selected.id : ''} onChange={(e) => e.target.value && choose(e.target.value)}>
            <option value="">{t('settings.modelChoose')}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('settings.modelManual')} htmlFor="model-id" hint={t('settings.modelHint')}>
        <input
          id="model-id"
          className={`${INPUT_CLASS} font-mono`}
          spellCheck={false}
          autoComplete="off"
          value={profile.model}
          onChange={(e) => onChange({ model: e.target.value, priceInPerM: undefined, priceOutPerM: undefined })}
        />
      </Field>
      {profile.priceInPerM !== undefined && profile.priceOutPerM !== undefined && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {t('settings.modelPrice', { input: formatUsd(profile.priceInPerM, locale), output: formatUsd(profile.priceOutPerM, locale) })}
        </p>
      )}
    </div>
  );
}
