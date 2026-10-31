import { EXPORT_MODES, type ExportMode, exportEpub, type Project, saveProjectFile } from '@epubtrans/core';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/i18n-context';
import { browserDomEnv } from '../../lib/dom-env';
import { downloadBytes, exportFileName, safeFileName } from '../../lib/download-file';
import { errorText } from '../../lib/notices';
import { countSegments } from '../../lib/segment-counts';
import { Button } from '../ui/button';
import { Alert, Card } from '../ui/layout-primitives';
import { ExportHintOptions } from './export-hint-options';

/** Builds the EPUB in the chosen layout, and offers the `.epubtrans` project file. */
export function ExportPanel({ project, version }: { project: Project; version: number }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ExportMode>('bilingual');
  const [busy, setBusy] = useState<'epub' | 'project'>();
  const [error, setError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place project mutations.
  const counts = useMemo(() => countSegments(project), [project, version]);
  const untranslated = counts.pending + counts.error;
  const baseName = safeFileName(project.title);

  const run = async (kind: 'epub' | 'project') => {
    setError(undefined);
    setBusy(kind);
    try {
      if (kind === 'epub') {
        const bytes = await exportEpub(project, mode, browserDomEnv());
        downloadBytes(bytes, exportFileName(project, mode), 'application/epub+zip');
      } else {
        downloadBytes(await saveProjectFile(project), `${baseName}.epubtrans`, 'application/zip');
      }
    } catch (err) {
      setError(t('export.failed', { message: errorText(err) }));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={t('export.title')}>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">{t('export.mode')}</legend>
          {EXPORT_MODES.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                mode === m
                  ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30'
                  : 'border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/50'
              }`}
            >
              <input type="radio" name="export-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 accent-teal-700" />
              <span>
                <span className="block text-sm font-medium">{t(`export.mode.${m}`)}</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400">{t(`export.mode.${m}.hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 space-y-2 border-t border-stone-200 pt-4 dark:border-stone-800">
          <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300">{t('export.hints')}</h3>
          <ExportHintOptions project={project} mode={mode} />
        </div>
        <div className="mt-4 space-y-3">
          {untranslated > 0 && mode !== 'original' && <Alert kind="warning">{t('export.incomplete', { n: untranslated })}</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
          <Button variant="primary" data-testid="export-epub" onClick={() => void run('epub')} disabled={busy !== undefined}>
            {busy === 'epub' ? t('export.exporting') : t('export.download')}
          </Button>
        </div>
      </Card>
      <Card title={t('export.project')}>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('export.projectHint')}</p>
        <Button className="mt-4" data-testid="export-project" onClick={() => void run('project')} disabled={busy !== undefined}>
          {t('export.downloadProject')}
        </Button>
      </Card>
    </div>
  );
}
