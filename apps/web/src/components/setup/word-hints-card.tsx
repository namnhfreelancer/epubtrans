import {
  glossLanguageOf,
  HINT_LEVEL_CEFR,
  hintRankThreshold,
  MAX_HINT_LEVEL,
  MIN_HINT_LEVEL,
  type Project,
  WORD_HINT_LANGUAGES,
  wordHintLanguage,
  wordHintSettingsOf,
} from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';
import { formatNumber } from '../../lib/format';
import { languageLabel } from '../../lib/languages';
import { errorText, pushNotice } from '../../lib/notices';
import { updateHintSettings } from '../../lib/project-settings-store';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { useFrequencyList } from '../../lib/word-frequency';
import { Alert, Card } from '../ui/layout-primitives';
import { LanguageInput } from './language-input';
import { WordHintsGenerator } from './word-hints-generator';

/**
 * Per-book Word Wise options on the setup page: the checkbox, the difficulty level (word frequency rank with an
 * approximate CEFR label) and the gloss language, plus the generator (estimate, Generate hints, progress).
 * Density and style are export options (see the export panel); they need no new requests.
 */
export function WordHintsCard({ project, version, provider }: { project: Project; version: number; provider: ActiveProviderState }) {
  const { t, locale } = useI18n();
  const settings = project.settings;
  const hints = wordHintSettingsOf(settings);
  const supported = wordHintLanguage(settings.sourceLang) !== undefined;
  const list = useFrequencyList(settings.sourceLang, hints.enabled && supported);
  const save = (patch: Parameters<typeof updateHintSettings>[1]) =>
    updateHintSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));
  const glossLang = glossLanguageOf(settings);

  return (
    <Card title={t('hints.title')}>
      <div className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="hints-enabled"
            className="mt-0.5 h-4 w-4 accent-teal-700"
            checked={hints.enabled}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('hints.enable')}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400">{t('hints.enableHint')}</span>
          </span>
        </label>
        {hints.enabled && !supported && (
          <Alert kind="warning">
            <span data-testid="hints-unsupported">
              {t('hints.unsupported', { languages: WORD_HINT_LANGUAGES.map((l) => languageLabel(l, locale)).join(', ') })}
            </span>
          </Alert>
        )}
        {hints.enabled && supported && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="hint-level" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                {t('hints.level')}:{' '}
                <span data-testid="hint-level-label">{t('hints.levelValue', { level: hints.level, cefr: HINT_LEVEL_CEFR[hints.level] ?? '' })}</span>
              </label>
              <input
                id="hint-level"
                type="range"
                min={MIN_HINT_LEVEL}
                max={MAX_HINT_LEVEL}
                step={1}
                className="w-full accent-teal-700"
                value={hints.level}
                onChange={(e) => void save({ level: Number(e.target.value) })}
              />
              <div className="flex justify-between text-xs text-stone-500 dark:text-stone-400">
                <span>{t('hints.fewer')}</span>
                <span>{t('hints.more')}</span>
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {t('hints.levelHint', { rank: formatNumber(hintRankThreshold(hints.level), locale) })}
              </p>
            </div>
            <div className="space-y-1">
              <LanguageInput
                id="gloss-lang"
                label={t('hints.glossLang')}
                value={glossLang}
                onCommit={(tag) => void save({ glossLang: tag === settings.targetLang ? undefined : tag })}
              />
              <p className="text-xs text-stone-500 dark:text-stone-400">{t('hints.glossLangNote')}</p>
            </div>
            {list.status === 'loading' && <p className="text-sm text-stone-500">{t('hints.loadingList')}</p>}
            {list.status === 'error' && <Alert kind="error">{t('hints.listFailed', { message: list.message })}</Alert>}
            {list.status === 'ready' && <WordHintsGenerator project={project} version={version} provider={provider} list={list.list} />}
          </>
        )}
        <p className="text-xs text-stone-500 dark:text-stone-400">{t('app.credits')}</p>
      </div>
    </Card>
  );
}
