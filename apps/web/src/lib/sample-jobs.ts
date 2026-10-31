import {
  type ChatProvider,
  type Project,
  type ProjectSettings,
  type SampleRunResult,
  type SampleSelection,
  type TokenUsage,
  translateSample,
} from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { launchWithJobLock } from './cross-tab-job-lock';
import { isHintJobActive } from './hint-jobs';
import type { SettingsGuard } from './project-repository';
import { refreshSettingsFromStorage } from './project-settings-store';
import { createJobBaseline, persistJobSegment, persistLastSample, touchProject } from './project-store';
import { isJobActive, type StartJobResult } from './translation-jobs';

export type SampleJobStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SampleJobState {
  status: SampleJobStatus;
  done: number;
  total: number;
  usage: TokenUsage;
  /** Why the run stopped (an exception: provider, storage, lock); absent when it ended because every segment failed. */
  error?: string;
  /**
   * Sampled segments whose sample translation failed in the finished run. One that already had a translation keeps
   * it (so the viewer shows the earlier text); one without becomes an 'error' segment. Status is 'failed' when every
   * segment that was sent failed, else 'done' with these listed as a warning.
   */
  failed: readonly string[];
  /** Sampled segments the run skipped because the user edited their translation by hand. */
  keptEdited: readonly string[];
}

/** Which passages to translate: exactly the given ones, or freshly picked ones (`seed` omitted: a random seed). */
export type SampleRequest = { selection: SampleSelection } | { passages: number; seed?: number };

const CANCEL = 'cancelled-by-user';
const IDLE: SampleJobState = { status: 'idle', done: 0, total: 0, usage: { input: 0, output: 0 }, failed: [], keptEdited: [] };

/**
 * Final state of a sample run that completed: 'failed' when every segment it sent failed (nothing new to judge),
 * otherwise 'done', carrying the failed and hand-edited segments so the UI can warn and label them.
 */
function finishedSampleState(current: SampleJobState, result: SampleRunResult): SampleJobState {
  const sampled = new Set(result.selection.passages.flatMap((p) => p.segmentIds)).size;
  const sent = sampled - result.keptEdited.length;
  const allFailed = result.failed.length > 0 && result.failed.length >= sent;
  return { ...current, status: allFailed ? 'failed' : 'done', failed: result.failed, keptEdited: result.keptEdited };
}

const jobs = new Map<string, SampleJobState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function setJob(id: string, next: SampleJobState): void {
  jobs.set(id, next);
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const getSampleJobState = (projectId: string): SampleJobState => jobs.get(projectId) ?? IDLE;

export const useSampleJob = (projectId: string): SampleJobState => useSyncExternalStore(subscribe, () => getSampleJobState(projectId));

/** Whether samples are being translated for the project; re-renders only when that flips, not on progress. */
export const useSampleRunning = (projectId: string): boolean => useSyncExternalStore(subscribe, () => jobs.get(projectId)?.status === 'running');

/**
 * Translates the sample in the background. A sample run is a paid job like the full run, so it holds the same
 * cross-tab job lock (`launchWithJobLock`): it does not start while another tab translates the book, and other
 * tabs cannot start a run (or edit segments) while it is running. Like the full run, every finished segment is
 * persisted right away (compare-and-set against the state the run started from, so an edit saved meanwhile in any
 * tab survives) and a persistence failure stops the run. Refuses to start while a full run (or another
 * sample run) is active in this tab. Resolves once it is known whether the sample started here. Like the full run,
 * it re-reads the book's settings from storage once it holds the lock and runs with `settingsFor` of them.
 */
export function startSampleJob(
  project: Project,
  settingsFor: (book: ProjectSettings) => ProjectSettings,
  provider: ChatProvider,
  request: SampleRequest,
): Promise<StartJobResult> {
  if (controllers.has(project.id) || isJobActive(project.id) || isHintJobActive(project.id)) return Promise.resolve('already-running');
  const controller = new AbortController();
  controllers.set(project.id, controller);
  const { started, settled } = launchWithJobLock(project.id, () => runSample(project, settingsFor, provider, request, controller));
  void settled
    .catch((err: unknown) => {
      // runSample records its own failures; this only catches the lock manager failing after the sample ran.
      setJob(project.id, { ...(jobs.get(project.id) ?? IDLE), status: 'failed', error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      // A start refused by the lock is forgotten right away (below), so a newer sample may own the entry by now.
      if (controllers.get(project.id) === controller) controllers.delete(project.id);
      touchProject(project.id);
    });
  return started.then((ran) => {
    if (ran) return 'started';
    if (controllers.get(project.id) === controller) controllers.delete(project.id);
    return 'busy-elsewhere';
  });
}

/** One sample run; never rejects (the outcome is recorded in the sample state). */
async function runSample(
  project: Project,
  settingsFor: (book: ProjectSettings) => ProjectSettings,
  provider: ChatProvider,
  request: SampleRequest,
  controller: AbortController,
): Promise<void> {
  setJob(project.id, { ...IDLE, status: 'running' });
  let settings: ProjectSettings;
  let guard: SettingsGuard;
  try {
    guard = await refreshSettingsFromStorage(project);
    settings = settingsFor(project.settings);
  } catch (err) {
    return setJob(project.id, { ...IDLE, status: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
  // Same compare-and-set baseline as a full run: an edit saved meanwhile (any tab) wins over the sample's answer.
  const baseline = createJobBaseline(project);
  let writeError: Error | undefined;
  const writes: Promise<unknown>[] = [];
  const track = (write: Promise<unknown>) =>
    writes.push(
      write.catch((err: unknown) => {
        writeError ??= err instanceof Error ? err : new Error(String(err));
        controller.abort(writeError);
      }),
    );

  try {
    const result = await translateSample(project, provider, settings, {
      ...request,
      signal: controller.signal,
      onSelect: (selection) => {
        track(persistLastSample(project.id, selection));
        touchProject(project.id);
      },
      onProgress: (p) => setJob(project.id, { ...IDLE, status: 'running', done: p.done, total: p.total, usage: p.usage }),
      onSegment: (segment) => {
        track(persistJobSegment(project, segment, baseline, guard));
        touchProject(project.id);
      },
    });
    await Promise.all(writes);
    if (writeError) throw writeError;
    setJob(project.id, finishedSampleState(jobs.get(project.id) ?? IDLE, result));
  } catch (err) {
    await Promise.all(writes);
    const failure = writeError ?? err;
    const cancelled = !writeError && controller.signal.aborted && controller.signal.reason === CANCEL;
    const current = jobs.get(project.id) ?? IDLE;
    setJob(
      project.id,
      cancelled ? { ...current, status: 'cancelled' } : { ...current, status: 'failed', error: failure instanceof Error ? failure.message : String(failure) },
    );
  }
}

/** Resolves with the sample state once no sample is running for the project (right away when none is). */
export function waitForSampleJob(projectId: string): Promise<SampleJobState> {
  return new Promise((resolve) => {
    const check = () => {
      const state = getSampleJobState(projectId);
      if (state.status === 'running') return false;
      unsubscribe();
      resolve(state);
      return true;
    };
    const unsubscribe = subscribe(() => void check());
    check();
  });
}

/** Stops a running sample; segments that already finished stay translated and persisted. */
export function cancelSampleJob(projectId: string): void {
  controllers.get(projectId)?.abort(CANCEL);
}
