import { composeGuideline, DEFAULT_GLOSSARY_CAP, GUIDELINE_PRESETS, type GuidelinePresetId, type Project, splitGuideline } from '@epubtrans/core';
import { useRef, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { guidelineSections } from '../../lib/glossary-view';
import { cancelGuideJob, reportGuideProblem, runGuideJob, useGuideJob } from '../../lib/guide-jobs';
import { errorText, pushNotice } from '../../lib/notices';
import { refreshSettingsFromStorage, updateSettings } from '../../lib/project-settings-store';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Card } from '../ui/layout-primitives';
import { GlossaryTable } from './glossary-table';
import { GuideGenerationStatus } from './guide-generation-status';

/**
 * Style guideline (preset + free text) and glossary, with model-assisted generation. Generation keeps the
 * current guideline as its base and appends a book-specific block; applying a preset replaces only the base.
 * The guideline, glossary and preset picker are locked while generating: the result is merged into a snapshot taken
 * at the start, so an edit made meanwhile would be overwritten.
 */
export function GuidelineCard({ project, provider }: { project: Project; provider: ActiveProviderState }) {
  const { t } = useI18n();
  const [presetId, setPresetId] = useState<GuidelinePresetId>('general');
  const [maxEntries, setMaxEntries] = useState(String(DEFAULT_GLOSSARY_CAP));
  // Kept in a store (not in this card) so a run started by an agent shows here too and outlives a tab switch.
  const state = useGuideJob(project.id);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const save = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));
  const { generated } = splitGuideline(project.settings.guideline);
  const sections = guidelineSections(project.settings.guideline);

  const applyPreset = () => {
    const preset = GUIDELINE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const label = t(`setup.preset.${preset.id}`);
    const question = generated ? t('guide.applyPresetKeepsGenerated', { preset: label }) : t('setup.applyPresetConfirm', { preset: label });
    if (project.settings.guideline.trim() && !window.confirm(question)) return;
    void save({ guideline: composeGuideline(preset.guideline, generated) });
  };

  const generate = () => {
    if (provider.problem) return reportGuideProblem(project.id, t(provider.problem));
    const cap = Number.parseInt(maxEntries, 10);
    void runGuideJob(project, () => provider.prepare(project), Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_GLOSSARY_CAP);
  };

  const cancel = () => cancelGuideJob(project.id);

  /** Moves the caret to a section heading and scrolls the textarea there. */
  const jumpTo = (offset: number) => {
    const area = textareaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(offset, offset);
    const lines = project.settings.guideline.split('\n').length;
    const line = project.settings.guideline.slice(0, offset).split('\n').length - 1;
    area.scrollTop = (area.scrollHeight / Math.max(1, lines)) * line;
  };

  const busy = state.kind === 'busy';
  return (
    <Card
      title={t('setup.guideline')}
      actions={
        <>
          {busy && <Button onClick={cancel}>{t('guide.cancel')}</Button>}
          <Button variant="primary" onClick={generate} disabled={busy}>
            {busy ? t('setup.generating') : t('setup.generate')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <GuideGenerationStatus state={state} />
        {busy && (
          <p data-testid="guide-locked-hint" className="text-xs text-amber-800 dark:text-amber-300">
            {t('guide.lockedWhileGenerating')}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56 space-y-1.5">
            <label htmlFor="guideline-preset" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
              {t('setup.guidelinePreset')}
            </label>
            <select
              id="guideline-preset"
              className={INPUT_CLASS}
              value={presetId}
              disabled={busy}
              onChange={(e) => setPresetId(e.target.value as GuidelinePresetId)}
            >
              {GUIDELINE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`setup.preset.${p.id}`)}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={applyPreset} disabled={busy}>
            {t('setup.applyPreset')}
          </Button>
          <div className="w-44 space-y-1.5">
            <label htmlFor="glossary-max" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
              {t('guide.maxEntries')}
            </label>
            <input
              id="glossary-max"
              type="number"
              min={1}
              max={5000}
              className={INPUT_CLASS}
              value={maxEntries}
              onChange={(e) => setMaxEntries(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {t('guide.extendsHint')} {t('guide.maxEntriesHint')}
        </p>
        {sections.length > 1 && (
          <nav aria-label={t('guide.sections')} className="flex flex-wrap gap-1.5">
            {sections.map((s) => (
              <Button key={s.offset} size="sm" variant="ghost" onClick={() => jumpTo(s.offset)} disabled={busy}>
                {s.title}
              </Button>
            ))}
          </nav>
        )}
        <label htmlFor="guideline" className="sr-only">
          {t('setup.guideline')}
        </label>
        <textarea
          id="guideline"
          ref={textareaRef}
          rows={generated ? 18 : 8}
          className={`${INPUT_CLASS} font-mono text-xs leading-relaxed`}
          value={project.settings.guideline}
          disabled={busy}
          onChange={(e) => void save({ guideline: e.target.value })}
        />
        <GlossaryTable
          entries={project.settings.glossary}
          onChange={(glossary) => void save({ glossary })}
          locked={busy}
          bookTitle={project.title}
          readCurrent={async () => {
            await refreshSettingsFromStorage(project);
            return project.settings.glossary;
          }}
        />
      </div>
    </Card>
  );
}
