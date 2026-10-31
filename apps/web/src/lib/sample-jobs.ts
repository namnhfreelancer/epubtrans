import { type ChatProvider, type Project, type ProjectSettings, type SampleSelection, type TokenUsage, translateSample } from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { persistLastSample, persistSegment, touchProject } from './project-store';
import { isJobActive } from './translation-jobs';

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

export const useSampleJob = (projectId: string): SampleJobState => useSyncExternalStore(subscribe, () => jobs.get(projectId) ?? IDLE);

/** Whether samples are being translated for the project; re-renders only when that flips, not on progress. */
export const useSampleRunning = (projectId: string): boolean => useSyncExternalStore(subscribe, () => jobs.get(projectId)?.status === 'running');

/**
 * Translates the sample in the background. Like the full run, every finished segment is persisted right away
 * and a persistence failure stops the run. Refuses to start while a full run (or another sample run) is active.
 */
export function startSampleJob(project: Project, settings: ProjectSettings, provider: ChatProvider, request: SampleRequest): void {
  if (controllers.has(project.id) || isJobActive(project.id)) return;
  const controller = new AbortController();
  controllers.set(project.id, controller);
  setJob(project.id, { ...IDLE, status: 'running' });
  let writeError: Error | undefined;
  const writes: Promise<void>[] = [];
  const track = (write: Promise<void>) =>
    writes.push(
      write.catch((err: unknown) => {
        writeError ??= err instanceof Error ? err : new Error(String(err));
        controller.abort(writeError);
      }),
    );

  const run = async () => {
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
          track(persistSegment(project.id, segment));
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
    } finally {
      controllers.delete(project.id);
      touchProject(project.id);
    }
  };
  void run();
}

/** Stops a running sample; segments that already finished stay translated and persisted. */
export function cancelSampleJob(projectId: string): void {
  controllers.get(projectId)?.abort(CANCEL);
}
