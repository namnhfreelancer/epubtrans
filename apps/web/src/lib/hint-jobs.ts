import { type ChatProvider, generateProjectWordHints, type Project, type ProjectSettings, type TokenUsage, type WordHintsPlan } from '@epubtrans/core';
import { useSyncExternalStore } from 'react';
import { launchWithJobLock } from './cross-tab-job-lock';
import { announceHints, persistHintEntry, persistHintsStart, touchProject } from './project-store';
import { getSampleJobState } from './sample-jobs';
import { isJobActive, type StartJobResult } from './translation-jobs';

export type HintJobStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface HintJobState {
  status: HintJobStatus;
  /** Lemmas finished in this run, out of the lemmas it sends. */
  done: number;
  total: number;
  usage: TokenUsage;
  /** Lemmas whose glosses stayed unusable; generating again retries them. */
  failed: number;
  error?: string;
}

const CANCEL = 'cancelled-by-user';
const IDLE: HintJobState = { status: 'idle', done: 0, total: 0, usage: { input: 0, output: 0 }, failed: 0 };
const jobs = new Map<string, HintJobState>();
const controllers = new Map<string, AbortController>();
/** Settles (never rejects) once a project's hints run and its cleanup finished. */
const runs = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function setJob(id: string, next: HintJobState): void {
  jobs.set(id, next);
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const getHintJobState = (projectId: string): HintJobState => jobs.get(projectId) ?? IDLE;
export const useHintJob = (projectId: string): HintJobState => useSyncExternalStore(subscribe, () => getHintJobState(projectId));
/** Whether hints are being generated for the project; re-renders only when that flips. */
export const useHintsRunning = (projectId: string): boolean => useSyncExternalStore(subscribe, () => jobs.get(projectId)?.status === 'running');
export const isHintJobActive = (projectId: string): boolean => controllers.has(projectId);

/**
 * Generates Word Wise glosses in the background for the lemmas the plan still lacks. Like translation and samples it
 * is a paid job, so it holds the project's cross-tab job lock and refuses to start while a translation or sample run
 * is active in this tab. Every finished lemma is persisted right away (so a reload resumes), and a persistence
 * failure stops the run. Resolves once it is known whether the run started here.
 */
export function startHintJob(project: Project, plan: WordHintsPlan, settings: ProjectSettings, provider: ChatProvider): Promise<StartJobResult> {
  if (controllers.has(project.id) || isJobActive(project.id) || getSampleJobState(project.id).status === 'running') return Promise.resolve('already-running');
  const controller = new AbortController();
  controllers.set(project.id, controller);
  const { started, settled } = launchWithJobLock(project.id, () => runHints(project, plan, settings, provider, controller));
  const run = settled
    .catch((err: unknown) => {
      setJob(project.id, { ...(jobs.get(project.id) ?? IDLE), status: 'failed', error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      if (controllers.get(project.id) === controller) controllers.delete(project.id);
      touchProject(project.id);
    });
  runs.set(project.id, run);
  void run.finally(() => {
    if (runs.get(project.id) === run) runs.delete(project.id);
  });
  return started.then((ran) => {
    if (ran) return 'started';
    if (controllers.get(project.id) === controller) controllers.delete(project.id);
    return 'busy-elsewhere';
  });
}

/** One hints run; never rejects (the outcome is recorded in the job state). */
async function runHints(project: Project, plan: WordHintsPlan, settings: ProjectSettings, provider: ChatProvider, controller: AbortController): Promise<void> {
  setJob(project.id, { ...IDLE, status: 'running', total: plan.candidates.length });
  let writeError: Error | undefined;
  const writes: Promise<void>[] = [];
  const track = (write: Promise<void>) =>
    writes.push(
      write.catch((err: unknown) => {
        writeError ??= err instanceof Error ? err : new Error(String(err));
        controller.abort(writeError);
      }),
    );
  let failed = 0;
  try {
    const result = await generateProjectWordHints(project, plan, provider, settings, {
      signal: controller.signal,
      onReset: (hints) => track(persistHintsStart(project.id, hints, plan.reset)),
      onEntry: (entry) => {
        track(persistHintEntry(project.id, plan, entry));
        touchProject(project.id);
      },
      onProgress: (p) => setJob(project.id, { ...(jobs.get(project.id) ?? IDLE), status: 'running', done: p.done, total: p.total, usage: p.usage }),
    });
    failed = result.failed;
    await Promise.all(writes);
    if (writeError) throw writeError;
    setJob(project.id, { ...(jobs.get(project.id) ?? IDLE), status: 'done', failed });
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
    await announceHints(project.id).catch(() => undefined);
  }
}

/** Stops a running hints job; lemmas that already finished stay saved, so generating again resumes. */
export function cancelHintJob(projectId: string): void {
  controllers.get(projectId)?.abort(CANCEL);
}

/** Cancels a running hints job and resolves once its run ended, so no write or request follows (used before deleting a book). */
export async function stopHintJob(projectId: string): Promise<void> {
  cancelHintJob(projectId);
  await runs.get(projectId);
}
