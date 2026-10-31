import type { Project } from '@epubtrans/core';
import type { MessageKey } from '../i18n/messages-en';
import type { Translate } from '../i18n/translate-message';
import { refreshJobLocks } from './cross-tab-job-lock';
import { errorText, pushNotice } from './notices';
import { updateSettings } from './project-store';
import { type StartJobResult, startJob } from './translation-jobs';
import type { ActiveProviderState } from './use-active-provider';

/** What happened to a start request: the job outcome, a missing provider setting, or an invalid configuration. */
export type StartTranslationOutcome = { kind: StartJobResult } | { kind: 'problem'; problem: MessageKey } | { kind: 'error'; message: string };

/**
 * Starts (or resumes) the translation job of a book: pending and failed segments are processed, finished ones are skipped.
 * Shared by the setup page, the reader's "Retry all failed" and the WebMCP `start_translation` tool, so all go through
 * the same provider checks, the same job registry (one job per book, so a running job blocks a second start) and the
 * same cross-tab job lock (one tab at a time translates a book).
 */
export async function startTranslation(project: Project, provider: ActiveProviderState, t: Translate): Promise<StartTranslationOutcome> {
  if (provider.problem) return { kind: 'problem', problem: provider.problem };
  try {
    const { provider: chat, settings } = provider.prepare(project);
    const result = await startJob(project, settings, chat);
    // Another tab won the lock before this one noticed: re-read the locks so the busy notice shows right away.
    if (result === 'busy-elsewhere') await refreshJobLocks();
    if (result === 'started') {
      // Remember which provider/model translated the book (carried in the project file, e.g. for CLI resume).
      const { providerId, baseURL, model } = settings;
      void updateSettings(project, { providerId, baseURL, model }).catch((err: unknown) =>
        pushNotice('error', t('common.saveFailed', { message: errorText(err) })),
      );
    }
    return { kind: result };
  } catch (err) {
    return { kind: 'error', message: errorText(err) };
  }
}
