import { type ChatProvider, type Project, type ProjectSettings, type TokenUsage, type TranslationPhase, translateProject } from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { runWithJobLock } from './cross-tab-job-lock';
import { createJobBaseline, persistJobSegment, touchProject } from './project-store';

export type JobStatus = 'idle' | 'running' | 'pausing' | 'paused' | 'done' | 'failed';
/** `busy-elsewhere`: another tab holds the project's job lock, so nothing was started here. */
export type StartJobResult = 'started' | 'already-running' | 'busy-elsewhere';

export interface JobState {
  status: JobStatus;
  phase: TranslationPhase;
  done: number;
  total: number;
  usage: TokenUsage;
  /** Epoch ms when the current phase started reporting progress (for the ETA). */
  phaseStartedAt: number;
  error?: string;
}

const PAUSE = 'paused-by-user';
const IDLE: JobState = { status: 'idle', phase: 'translate', done: 0, total: 0, usage: { input: 0, output: 0 }, phaseStartedAt: 0 };
const jobs = new Map<string, JobState>();
const controllers = new Map<string, AbortController>();
const runs = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function setJob(id: string, patch: Partial<JobState>): void {
  jobs.set(id, { ...(jobs.get(id) ?? IDLE), ...patch });
  for (const l of [...listeners]) l();
}

export function useJob(projectId: string): JobState {
  return useSyncExternalStore(subscribe, () => jobs.get(projectId) ?? IDLE);
}

export const isJobActive = (projectId: string): boolean => controllers.has(projectId);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Whether a job is running (or pausing) for the project; re-renders only when that flips, not on progress. */
export function useJobActive(projectId: string): boolean {
  return useSyncExternalStore(subscribe, () => {
    const status = jobs.get(projectId)?.status;
    return status === 'running' || status === 'pausing';
  });
}

/** Remaining time in ms from the observed rate, or undefined until there is enough signal. */
export function estimateRemainingMs(job: Pick<JobState, 'done' | 'total' | 'phaseStartedAt'>, now: number): number | undefined {
  const elapsed = now - job.phaseStartedAt;
  if (job.done <= 0 || job.done >= job.total || elapsed <= 0) return undefined;
  return Math.round((elapsed / job.done) * (job.total - job.done));
}

/**
 * Starts (or resumes) translating a project in the background, holding the project's cross-tab job lock
 * for the whole run. Resolves once it is known whether the job started here. Finished segments are skipped
 * by core, each finished segment is persisted right away (compare-and-set, so an edit saved meanwhile in
 * any tab wins), and a persistence failure stops the run so progress is never lost silently.
 */
export function startJob(project: Project, settings: ProjectSettings, provider: ChatProvider): Promise<StartJobResult> {
  if (controllers.has(project.id)) return Promise.resolve('already-running');
  const controller = new AbortController();
  controllers.set(project.id, controller);
  let report: (result: StartJobResult) => void = () => {};
  const outcome = new Promise<StartJobResult>((resolve) => {
    report = resolve;
  });
  const run = runWithJobLock(project.id, () => {
    report('started');
    return runJob(project, settings, provider, controller);
  })
    .then((acquired) => {
      if (!acquired) report('busy-elsewhere');
    })
    .catch((err: unknown) => {
      // runJob records its own failures; this only catches the lock manager failing after the job ran.
      setJob(project.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
      report('started');
    })
    .finally(() => {
      controllers.delete(project.id);
      runs.delete(project.id);
      touchProject(project.id);
    });
  runs.set(project.id, run);
  return outcome;
}

/** One run of core's translator; never rejects (the outcome is recorded in the job state). */
async function runJob(project: Project, settings: ProjectSettings, provider: ChatProvider, controller: AbortController): Promise<void> {
  setJob(project.id, { ...IDLE, status: 'running', phaseStartedAt: Date.now() });
  const baseline = createJobBaseline(project);
  let writeError: Error | undefined;
  const writes: Promise<void>[] = [];
  let phase: TranslationPhase | undefined;
  try {
    await translateProject(project, provider, settings, {
      signal: controller.signal,
      onProgress: (p) => {
        const patch: Partial<JobState> = { phase: p.phase, done: p.done, total: p.total, usage: p.usage };
        if (p.phase !== phase) {
          phase = p.phase;
          patch.phaseStartedAt = Date.now();
        }
        setJob(project.id, patch);
      },
      onSegment: (segment) => {
        const write = persistJobSegment(project, segment, baseline).catch((err: unknown) => {
          writeError ??= err instanceof Error ? err : new Error(String(err));
          controller.abort(writeError);
        });
        writes.push(write);
        touchProject(project.id);
      },
    });
    await Promise.all(writes);
    if (writeError) throw writeError;
    setJob(project.id, { status: 'done' });
  } catch (err) {
    await Promise.all(writes);
    const failure = writeError ?? err;
    const paused = !writeError && controller.signal.aborted && controller.signal.reason === PAUSE;
    setJob(project.id, paused ? { status: 'paused' } : { status: 'failed', error: failure instanceof Error ? failure.message : String(failure) });
  }
}

/** Pauses a running job; finished segments are already persisted, so starting again resumes. */
export function pauseJob(projectId: string): void {
  const controller = controllers.get(projectId);
  if (!controller) return;
  setJob(projectId, { status: 'pausing' });
  controller.abort(PAUSE);
}

/** Stops a job (if any), waits until it has settled and forgets its state; used before deleting a project. */
export async function discardJob(projectId: string): Promise<void> {
  controllers.get(projectId)?.abort(PAUSE);
  await runs.get(projectId);
  jobs.delete(projectId);
  for (const l of [...listeners]) l();
}
