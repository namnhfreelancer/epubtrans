import {
  DEFAULT_IDENTICAL_MIN_LETTERS,
  DEFAULT_MAX_BATCH_SEGMENTS,
  detectLanguage,
  getProviderPreset,
  MAX_BATCH_SEGMENTS_LIMIT,
  MAX_CONCURRENCY,
  MAX_IDENTICAL_MIN_LETTERS,
  type Project,
} from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { routeHref } from '../../lib/hash-route';
import { languageLabel } from '../../lib/languages';
import { errorText, pushNotice } from '../../lib/notices';
import { targetChangeNeedsDecision, translatedSegmentCount, updateSettings, updateSettingsAndResetTranslations } from '../../lib/project-store';
import type { ActiveProvider } from '../../lib/provider-config-store';
import { Button } from '../ui/button';
import { ChoiceDialog } from '../ui/choice-dialog';
import { INPUT_CLASS } from '../ui/input-class';
import { Card, Field } from '../ui/layout-primitives';
import { LanguageInput } from './language-input';

type TargetChoice = 'keep' | 'reset';

/** Parses an optional integer field: empty clears the setting (default applies), out-of-range input is ignored. */
function parseIntegerField(input: string, min: number, max: number): number | undefined | null {
  if (input.trim() === '') return undefined;
  const n = Number(input);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Language pair, concurrency, two-pass toggle, request tuning and the provider/model used for this book. */
export function LanguageOptionsCard({ project, active }: { project: Project; active: ActiveProvider }) {
  const { t, locale } = useI18n();
  const [detected, setDetected] = useState<string>();
  /** A target language waiting for the user's decision about existing translations. */
  const [pendingTarget, setPendingTarget] = useState<string>();
  /** Bumped to reset the target field to the saved value after a cancelled change. */
  const [targetKey, setTargetKey] = useState(0);
  const settings = project.settings;
  const translated = translatedSegmentCount(project);
  const save = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));

  const detect = () => {
    const lang = detectLanguage(project);
    setDetected(lang === 'und' ? t('setup.detectFailed') : t('setup.detected', { lang: `${languageLabel(lang, locale)} (${lang})` }));
    if (lang !== 'und') void save({ sourceLang: lang });
  };

  const commitTarget = (tag: string) => {
    if (targetChangeNeedsDecision(project, tag)) setPendingTarget(tag);
    else void save({ targetLang: tag });
  };

  const decideTarget = async (choice: TargetChoice | undefined) => {
    const tag = pendingTarget;
    setPendingTarget(undefined);
    if (!tag || !choice) {
      setTargetKey((k) => k + 1);
      return;
    }
    if (choice === 'keep') return void save({ targetLang: tag });
    try {
      const result = await updateSettingsAndResetTranslations(project, { targetLang: tag });
      if (result === 'busy') {
        pushNotice('error', t('setup.targetResetBusy'));
        setTargetKey((k) => k + 1);
      } else pushNotice('success', t('setup.targetResetDone', { n: translated }));
    } catch (err) {
      pushNotice('error', t('common.saveFailed', { message: errorText(err) }));
      setTargetKey((k) => k + 1);
    }
  };

  const saveInteger = (key: 'maxSegmentsPerBatch' | 'identicalMinLetters', input: string, min: number, max: number) => {
    const value = parseIntegerField(input, min, max);
    if (value !== null) void save({ [key]: value });
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
        <LanguageInput
          key={`${settings.targetLang}-${targetKey}`}
          id="target-lang"
          label={t('setup.target')}
          value={settings.targetLang}
          commitOnBlur={translated > 0}
          onCommit={commitTarget}
        />
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
        <Field label={t('setup.maxSegments')} htmlFor="max-segments" hint={t('setup.maxSegmentsHint', { n: DEFAULT_MAX_BATCH_SEGMENTS })}>
          <input
            id="max-segments"
            type="number"
            min={1}
            max={MAX_BATCH_SEGMENTS_LIMIT}
            className={INPUT_CLASS}
            placeholder={String(DEFAULT_MAX_BATCH_SEGMENTS)}
            defaultValue={settings.maxSegmentsPerBatch ?? ''}
            onChange={(e) => saveInteger('maxSegmentsPerBatch', e.target.value, 1, MAX_BATCH_SEGMENTS_LIMIT)}
          />
        </Field>
        <Field
          label={t('setup.identicalMinLetters')}
          htmlFor="identical-min-letters"
          hint={t('setup.identicalMinLettersHint', { n: DEFAULT_IDENTICAL_MIN_LETTERS })}
        >
          <input
            id="identical-min-letters"
            type="number"
            min={0}
            max={MAX_IDENTICAL_MIN_LETTERS}
            className={INPUT_CLASS}
            placeholder={String(DEFAULT_IDENTICAL_MIN_LETTERS)}
            defaultValue={settings.identicalMinLetters ?? ''}
            onChange={(e) => saveInteger('identicalMinLetters', e.target.value, 0, MAX_IDENTICAL_MIN_LETTERS)}
          />
        </Field>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 text-sm text-stone-600 dark:text-stone-400">
        <span data-testid="provider-summary">
          {t('setup.provider', { provider: getProviderPreset(active.providerId).label, model: active.model || t('setup.noModel') })}
        </span>
        <a href={routeHref({ name: 'settings' })} className="text-teal-700 underline underline-offset-2 dark:text-teal-400">
          {t('setup.changeProvider')}
        </a>
      </p>
      {pendingTarget && (
        <ChoiceDialog<TargetChoice>
          testId="target-change-dialog"
          title={t('setup.targetChangeTitle')}
          cancelLabel={t('common.cancel')}
          choices={[
            { id: 'keep', label: t('setup.targetKeep') },
            { id: 'reset', label: t('setup.targetReset', { n: translated }), variant: 'danger' },
          ]}
          onClose={(choice) => void decideTarget(choice)}
        >
          <p>
            {t('setup.targetChangeBody', {
              n: translated,
              from: languageLabel(settings.targetLang, locale),
              to: languageLabel(pendingTarget, locale),
            })}
          </p>
          <p>{t('setup.targetChangeHint')}</p>
        </ChoiceDialog>
      )}
    </Card>
  );
}
