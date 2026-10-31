import { type ChatProvider, type Project, type ProjectSettings, type SampleSelection, type TokenUsage, translateSample } from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { launchWithJobLock } from './cross-tab-job-lock';
import { createJobBaseline, persistJobSegment, persistLastSample, touchProject } from './project-store';
import { isJobActive, type StartJobResult } from './translation-jobs';

export type SampleJobStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SampleJobState {
  status: SampleJobStatus;
  done: number;
  total: number;
  usage: TokenUsage;
  error?: string;
}

/** Which passages to translate: exactly the given ones, or freshly picked ones (`seed` omitted: a random seed). */
export type SampleRequest = { selection: SampleSelection } | { passages: number; seed?: number };

const CANCEL = 'cancelled-by-user';
const IDLE: SampleJobState = { status: 'idle', done: 0, total: 0, usage: { input: 0, output: 0 } };
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
 * sample run) is active in this tab. Resolves once it is known whether the sample started here.
 */
export function startSampleJob(project: Project, settings: ProjectSettings, provider: ChatProvider, request: SampleRequest): Promise<StartJobResult> {
  if (controllers.has(project.id) || isJobActive(project.id)) return Promise.resolve('already-running');
  const controller = new AbortController();
  controllers.set(project.id, controller);
  const { started, settled } = launchWithJobLock(project.id, () => runSample(project, settings, provider, request, controller));
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
  settings: ProjectSettings,
  provider: ChatProvider,
  request: SampleRequest,
  controller: AbortController,
): Promise<void> {
  setJob(project.id, { ...IDLE, status: 'running' });
  // Same compare-and-set baseline as a full run: an edit saved meanwhile (any tab) wins over the sample's answer.
  const baseline = createJobBaseline(project);
  let writeError: Error | undefined;
  const writes: Promise<void>[] = [];
  const track = (write: Promise<void>) =>
    writes.push(
      write.catch((err: unknown) => {
        writeError ??= err instanceof Error ? err : new Error(String(err));
        controller.abort(writeError);
      }),
    );

  try {
    await translateSample(project, provider, settings, {
      ...request,
      signal: controller.signal,
      onSelect: (selection) => {
        track(persistLastSample(project.id, selection));
        touchProject(project.id);
      },
      onProgress: (p) => setJob(project.id, { status: 'running', done: p.done, total: p.total, usage: p.usage }),
      onSegment: (segment) => {
        track(persistJobSegment(project, segment, baseline));
        touchProject(project.id);
      },
    });
    await Promise.all(writes);
    if (writeError) throw writeError;
    setJob(project.id, { ...(jobs.get(project.id) ?? IDLE), status: 'done' });
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

/** Stops a running sample; segments that already finished stay translated and persisted. */
export function cancelSampleJob(projectId: string): void {
  controllers.get(projectId)?.abort(CANCEL);
}
