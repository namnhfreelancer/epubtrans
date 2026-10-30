import { GUIDELINE_PRESETS, type GuidelinePresetId, generateGuide, type Project } from '@epubtrans/core';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { errorText, pushNotice } from '../../lib/notices';
import { updateSettings } from '../../lib/project-store';
import type { ActiveProviderState } from '../../lib/use-active-provider';
import { Button } from '../ui/button';
import { INPUT_CLASS } from '../ui/input-class';
import { Alert, Card } from '../ui/layout-primitives';
import { GlossaryTable } from './glossary-table';

type GenerateState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string };

/** Style guideline (preset + free text) and glossary, with model-assisted generation. */
export function GuidelineCard({ project, provider }: { project: Project; provider: ActiveProviderState }) {
  const { t } = useI18n();
  const [presetId, setPresetId] = useState<GuidelinePresetId>('general');
  const [state, setState] = useState<GenerateState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const save = (patch: Parameters<typeof updateSettings>[1]) =>
    updateSettings(project, patch).catch((err: unknown) => pushNotice('error', t('common.saveFailed', { message: errorText(err) })));

  useEffect(() => () => abortRef.current?.abort(), []);

  const applyPreset = () => {
    const preset = GUIDELINE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const label = t(`setup.preset.${preset.id}`);
    if (project.settings.guideline.trim() && !window.confirm(t('setup.applyPresetConfirm', { preset: label }))) return;
    void save({ guideline: preset.guideline });
  };

  const generate = async () => {
    if (provider.problem) return setState({ kind: 'error', message: t(provider.problem) });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'busy' });
    try {
      const { provider: chat, settings } = provider.prepare(project);
      const guide = await generateGuide(project, chat, settings, controller.signal);
      await updateSettings(project, { guideline: guide.guideline, glossary: guide.glossary });
      if (!controller.signal.aborted) setState({ kind: 'done' });
    } catch (err) {
      if (!controller.signal.aborted) setState({ kind: 'error', message: errorText(err) });
    }
  };

  return (
    <Card
      title={t('setup.guideline')}
      actions={
        <Button variant="primary" onClick={() => void generate()} disabled={state.kind === 'busy'}>
          {state.kind === 'busy' ? t('setup.generating') : t('setup.generate')}
        </Button>
      }
    >
      <div className="space-y-4">
        {state.kind === 'done' && <Alert kind="success">{t('setup.generated')}</Alert>}
        {state.kind === 'error' && <Alert kind="error">{t('setup.generateFailed', { message: state.message })}</Alert>}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56 space-y-1.5">
            <label htmlFor="guideline-preset" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
              {t('setup.guidelinePreset')}
            </label>
            <select id="guideline-preset" className={INPUT_CLASS} value={presetId} onChange={(e) => setPresetId(e.target.value as GuidelinePresetId)}>
              {GUIDELINE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`setup.preset.${p.id}`)}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={applyPreset}>{t('setup.applyPreset')}</Button>
        </div>
        <label htmlFor="guideline" className="sr-only">
          {t('setup.guideline')}
        </label>
        <textarea
          id="guideline"
          rows={8}
          className={`${INPUT_CLASS} font-mono text-xs leading-relaxed`}
          value={project.settings.guideline}
          onChange={(e) => void save({ guideline: e.target.value })}
        />
        <GlossaryTable entries={project.settings.glossary} onChange={(glossary) => void save({ glossary })} />
      </div>
    </Card>
  );
}
