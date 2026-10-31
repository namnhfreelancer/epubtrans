import type { Project } from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../i18n/i18n-context';
import { useJobRunningElsewhere } from './cross-tab-job-lock';
import { startTranslation } from './start-translation';
import { useJobActive } from './translation-jobs';
import type { ActiveProviderState } from './use-active-provider';

export interface StartTranslation {
  start: () => Promise<void>;
  error: string | undefined;
  /** Another tab holds the book's job lock: starting here is refused, so callers disable Start and show `run.busyElsewhere`. */
  busyElsewhere: boolean;
}

/**
 * React binding of {@link startTranslation} for the setup page ("Retry failed segments") and the reader ("Retry all failed"):
 * keeps the last start error and tracks whether another tab holds the book's job lock.
 */
export function useStartTranslation(project: Project, provider: ActiveProviderState): StartTranslation {
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  const jobHere = useJobActive(project.id);
  const busyElsewhere = useJobRunningElsewhere(project.id) && !jobHere;

  const start = async () => {
    setError(undefined);
    const outcome = await startTranslation(project, provider, t);
    if (outcome.kind === 'problem') setError(t(outcome.problem));
    else if (outcome.kind === 'error') setError(outcome.message);
  };

  return { start, error, busyElsewhere };
}
