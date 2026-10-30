import { useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { apiKeys } from '../../lib/api-key-store';
import { useExternalStore } from '../../lib/external-store';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Field } from '../ui/layout-primitives';

/** Password input for the provider key with an opt-in "remember on this device" checkbox. */
export function ApiKeyField({ providerId, host }: { providerId: string; host?: string }) {
  const { t } = useI18n();
  const state = useExternalStore(apiKeys.store);
  const key = state.keys[providerId] ?? '';
  const remembered = state.remembered[providerId] === true;
  const [storageFailed, setStorageFailed] = useState(false);

  const update = (value: string, remember: boolean) => setStorageFailed(!apiKeys.setKey(providerId, value, remember));

  return (
    <div className="space-y-3">
      <Field label={t('settings.apiKey')} htmlFor="api-key" error={storageFailed ? t('settings.rememberFailed') : undefined}>
        <div className="flex gap-2">
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={`${INPUT_CLASS} font-mono`}
            placeholder={t('settings.apiKeyPlaceholder')}
            value={key}
            onChange={(e) => update(e.target.value, remembered)}
          />
          <Button onClick={() => apiKeys.clearKey(providerId)} disabled={!key && !remembered}>
            {t('settings.clearKey')}
          </Button>
        </div>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-700" checked={remembered} onChange={(e) => update(key, e.target.checked)} />
        <span>
          <span className="font-medium">{t('settings.remember')}</span>
          <span className="block text-xs text-stone-500 dark:text-stone-400">{remembered ? t('settings.rememberOn') : t('settings.rememberOff')}</span>
        </span>
      </label>
      <p
        data-testid="key-note"
        className="flex items-start gap-2 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" strokeLinejoin="round" />
        </svg>
        {host ? t('settings.keyNote', { host }) : t('settings.keyNoteNoHost')}
      </p>
    </div>
  );
}
