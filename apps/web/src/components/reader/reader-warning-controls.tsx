import { useI18n } from '../../i18n/i18n-context';
import type { StepDirection } from '../../lib/error-index';
import { Button } from '../ui/button';

interface ReaderWarningControlsProps {
  total: number;
  /** 1-based position of the segment last jumped to, when it still has a warning. */
  ordinal: number | undefined;
  canStep: Record<StepDirection, boolean>;
  onStep: (direction: StepDirection) => void;
  onlyWarnings: boolean;
  onOnlyWarningsChange: (value: boolean) => void;
}

/**
 * Previous/next warning and a warnings-only filter. Warnings (a translation identical to its source) are not errors:
 * the segment counts as translated and is exported as it is, so there is no retry here; Edit or Retranslate fixes one.
 */
export function ReaderWarningControls({ total, ordinal, canStep, onStep, onlyWarnings, onOnlyWarningsChange }: ReaderWarningControlsProps) {
  const { t } = useI18n();
  return (
    <fieldset data-testid="warning-controls" className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-0 p-0 pt-3">
      <legend className="sr-only">{t('reader.warningNav')}</legend>
      <span className="inline-flex items-center gap-1">
        <Button size="sm" data-testid="prev-warning" onClick={() => onStep(-1)} disabled={!canStep[-1]}>
          ↑ {t('reader.prevWarning')}
        </Button>
        <Button size="sm" data-testid="next-warning" onClick={() => onStep(1)} disabled={!canStep[1]}>
          ↓ {t('reader.nextWarning')}
        </Button>
      </span>
      <span data-testid="warning-count" aria-live="polite" className="min-w-16 text-xs font-medium text-amber-800 tabular-nums dark:text-amber-300">
        {ordinal !== undefined
          ? t('reader.warningPosition', { n: ordinal, total })
          : total === 1
            ? t('reader.warningsOne')
            : t('reader.warnings', { n: total })}
      </span>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
        <input type="checkbox" data-testid="only-warnings" checked={onlyWarnings} onChange={(e) => onOnlyWarningsChange(e.target.checked)} />
        {t('reader.onlyWarnings')}
      </label>
      <span className="basis-full text-xs text-stone-500 dark:text-stone-400">{t('reader.identicalHint')}</span>
    </fieldset>
  );
}
