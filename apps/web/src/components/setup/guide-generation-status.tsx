import { useI18n } from '../../i18n/i18n-context';
import type { GuideJobState } from '../../lib/guide-jobs';
import { Alert, ProgressBar } from '../ui/layout-primitives';

/** Phase-by-phase progress of guideline and glossary generation, then its outcome. */
export function GuideGenerationStatus({ state }: { state: GuideJobState }) {
  const { t } = useI18n();
  if (state.kind === 'done') {
    return (
      <Alert kind="success">
        {t('setup.generated')} {t('guide.summary', { entries: state.entries, candidates: state.candidates })}
        {state.skippedBatches > 0 && ` ${t('guide.skipped', { n: state.skippedBatches })}`}
      </Alert>
    );
  }
  if (state.kind === 'error') return <Alert kind="error">{t('setup.generateFailed', { message: state.message })}</Alert>;
  if (state.kind !== 'busy') return null;
  const p = state.progress ?? { phase: 'extract', done: 0, total: 1 };
  const label = p.phase === 'glossary' ? t('guide.phase.glossary', { done: p.done, total: p.total }) : t(`guide.phase.${p.phase}`);
  return (
    <div data-testid="guide-progress" className="space-y-1.5 text-sm text-stone-600 dark:text-stone-300">
      <p aria-live="polite">{label}</p>
      {p.phase === 'glossary' && <ProgressBar value={p.done} max={p.total} label={label} />}
    </div>
  );
}
