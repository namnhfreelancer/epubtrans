import {
  type ExportMode,
  MAX_HINTS_PER_CHAPTER_LIMIT,
  MAX_HINTS_PER_PARAGRAPH_LIMIT,
  type Project,
  WORD_HINT_STYLES,
  type WordHintSettings,
  wordHintSettingsOf,
} from '@epubtrans/core';
import { useI18n } from '../../i18n/i18n-context';
import { languageLabel } from '../../lib/languages';
import { errorText, pushNotice } from '../../lib/notices';
import { updateHintSettings } from '../../lib/project-settings-store';
import { INPUT_CLASS } from '../ui/input-class';
import { Alert, Field } from '../ui/layout-primitives';

const clampCount = (raw: string, max: number) => Math.min(max, Math.max(0, Math.floor(Number(raw)) || 0));

/** Word Wise status and export-time options (style and density): changing them needs no new requests. */
export function ExportHintOptions({ project, mode }: { project: Project; mode: ExportMode }) {
  const { t, locale } = useI18n();
  const hints = wordHintSettingsOf(project.settings);
  const glossed = project.wordHints?.entries.length ?? 0;
  const save = (patch: Partial<WordHintSettings>) =>
    updateHintSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));

  if (!hints.enabled) return <p className="text-xs text-stone-500 dark:text-stone-400">{t('export.hintsOff')}</p>;
  if (glossed === 0) return <p className="text-xs text-stone-500 dark:text-stone-400">{t('export.hintsNone')}</p>;
  return (
    <div className="space-y-3">
      <p data-testid="export-hints-summary" className="text-sm text-stone-600 dark:text-stone-400">
        {t('export.hintsSummary', { n: glossed, lang: languageLabel(project.wordHints?.glossLang ?? '', locale), level: hints.level })}
      </p>
      {mode === 'translation-only' && <Alert kind="warning">{t('export.hintsNotInTranslationOnly')}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('export.hintStyle')} htmlFor="hint-style" hint={t('export.hintStyleHint')}>
          <select
            id="hint-style"
            className={INPUT_CLASS}
            value={hints.style}
            onChange={(e) => void save({ style: e.target.value === 'inline' ? 'inline' : 'ruby' })}
          >
            {WORD_HINT_STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`export.hintStyle.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('export.maxPerParagraph')} htmlFor="hints-per-paragraph" hint={t('export.maxPerParagraphHint')}>
          <input
            id="hints-per-paragraph"
            type="number"
            min={0}
            max={MAX_HINTS_PER_PARAGRAPH_LIMIT}
            className={INPUT_CLASS}
            value={hints.maxPerParagraph}
            onChange={(e) => void save({ maxPerParagraph: clampCount(e.target.value, MAX_HINTS_PER_PARAGRAPH_LIMIT) })}
          />
        </Field>
        <Field label={t('export.perChapter')} htmlFor="hints-per-chapter" hint={t('export.perChapterHint')}>
          <input
            id="hints-per-chapter"
            type="number"
            min={0}
            max={MAX_HINTS_PER_CHAPTER_LIMIT}
            className={INPUT_CLASS}
            value={hints.perChapter}
            onChange={(e) => void save({ perChapter: clampCount(e.target.value, MAX_HINTS_PER_CHAPTER_LIMIT) })}
          />
        </Field>
      </div>
    </div>
  );
}
