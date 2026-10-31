import { useI18n } from '../../i18n/i18n-context';
import type { StepDirection } from '../../lib/error-index';
import { Button } from '../ui/button';

interface ReaderErrorControlsProps {
  total: number;
  /** 1-based position of the segment last jumped to, when it is still an error. */
  ordinal: number | undefined;
  canStep: Record<StepDirection, boolean>;
  onStep: (direction: StepDirection) => void;
  onlyErrors: boolean;
  onOnlyErrorsChange: (value: boolean) => void;
  retry: {
    running: boolean;
    /** Untranslated work remains: the button opens the setup page (estimate + Start) instead of retrying directly. */
    resume?: { pending: number; failed: number };
    /** Why "Retry all failed" is disabled (samples or hints running, or a job in another tab). */
    blockedHint?: string;
    /** Another tab is translating the book: the hint is also shown as a notice. */
    busyElsewhere?: boolean;
    error?: string;
    onRetry: () => void;
    onPause: () => void;
  };
}

/** Previous/next error, errors-only filter and "retry all failed" ("resume translation" while untranslated work remains); the `[` and `]` keys step like the buttons. */
export function ReaderErrorControls({ total, ordinal, canStep, onStep, onlyErrors, onOnlyErrorsChange, retry }: ReaderErrorControlsProps) {
  const { t } = useI18n();
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-0 p-0 pt-3">
      <legend className="sr-only">{t('reader.errorNav')}</legend>
      <span className="inline-flex items-center gap-1">
        <Button
          size="sm"
          data-testid="prev-error"
          onClick={() => onStep(-1)}
          disabled={!canStep[-1]}
          aria-keyshortcuts="["
          title={`${t('reader.prevError')} ([)`}
        >
          ↑ {t('reader.prevError')}
        </Button>
        <Button
          size="sm"
          data-testid="next-error"
          onClick={() => onStep(1)}
          disabled={!canStep[1]}
          aria-keyshortcuts="]"
          title={`${t('reader.nextError')} (])`}
        >
          ↓ {t('reader.nextError')}
        </Button>
      </span>
      <span data-testid="error-position" aria-live="polite" className="min-w-16 text-xs font-medium text-red-800 tabular-nums dark:text-red-300">
        {ordinal !== undefined && t('reader.errorPosition', { n: ordinal, total })}
      </span>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
        <input type="checkbox" data-testid="only-errors" checked={onlyErrors} onChange={(e) => onOnlyErrorsChange(e.target.checked)} />
        {t('reader.onlyErrors')}
      </label>
      <span className="ml-auto flex items-center gap-2">
        {retry.running && (
          <Button size="sm" variant="ghost" onClick={retry.onPause}>
            {t('run.pause')}
          </Button>
        )}
        {total > 0 && (
          <Button
            size="sm"
            variant="primary"
            data-testid="retry-all-failed"
            onClick={retry.onRetry}
            disabled={Boolean(retry.busyElsewhere) || (!retry.resume && (retry.running || Boolean(retry.blockedHint)))}
            title={retry.resume ? t('reader.resumeHint') : retry.blockedHint}
          >
            {retry.resume ? t('reader.resumeTranslation', retry.resume) : retry.running ? t('reader.retryingAll') : t('reader.retryAll')}
          </Button>
        )}
      </span>
      {retry.busyElsewhere && retry.blockedHint && (
        <p data-testid="retry-busy-elsewhere" className="basis-full text-xs text-amber-800 dark:text-amber-300">
          {retry.blockedHint}
        </p>
      )}
      {retry.error && (
        <p role="alert" className="basis-full text-xs text-red-700 dark:text-red-400">
          {retry.error}
        </p>
      )}
    </fieldset>
  );
}
