import type { Project } from '@epubtrans/core';
import { useState } from 'react';
import { useI18n } from '../i18n/i18n-context';
import { refreshJobLocks, useJobRunningElsewhere } from './cross-tab-job-lock';
import { errorText, pushNotice } from './notices';
import { updateSettings } from './project-store';
import { startJob, useJobActive } from './translation-jobs';
import type { ActiveProviderState } from './use-active-provider';

export interface StartTranslation {
  start: () => Promise<void>;
  error: string | undefined;
  /** Another tab holds the book's job lock: starting here is refused, so callers disable Start and show `run.busyElsewhere`. */
  busyElsewhere: boolean;
}

/**
 * Starts (or resumes) the translation job of a book: pending and failed segments are processed, finished ones are skipped.
 * Shared by the setup page ("Retry failed segments") and the reader ("Retry all failed") so both go through the same
 * provider checks, the same job registry (one job per book, so a running job blocks a second start) and the same
 * cross-tab job lock (one tab at a time translates a book).
 */
export function useStartTranslation(project: Project, provider: ActiveProviderState): StartTranslation {
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  const jobHere = useJobActive(project.id);
  const busyElsewhere = useJobRunningElsewhere(project.id) && !jobHere;

  const start = async () => {
    setError(undefined);
    if (provider.problem) return setError(t(provider.problem));
    try {
      const { provider: chat, settings } = provider.prepare(project);
      const result = await startJob(project, settings, chat);
      // Another tab won the lock before this one noticed: re-read the locks so the busy notice shows right away.
      if (result === 'busy-elsewhere') return await refreshJobLocks();
      if (result !== 'started') return;
      // Remember which provider/model translated the book (carried in the project file, e.g. for CLI resume).
      const { providerId, baseURL, model } = settings;
      void updateSettings(project, { providerId, baseURL, model }).catch((err: unknown) =>
        pushNotice('error', t('common.saveFailed', { message: errorText(err) })),
      );
    } catch (err) {
      setError(errorText(err));
    }
  };

  return { start, error, busyElsewhere };
}
