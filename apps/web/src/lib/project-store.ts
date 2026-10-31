import type { Project, ProjectSettings, SampleSelection, Segment } from '@epubtrans/core';
import { useEffect, useSyncExternalStore } from 'react';
import { repository } from './app-services';
import { broadcast, closeProjectChannel, onCrossTabMessage, watchProjectChannel } from './cross-tab-channel';
import { createExternalStore } from './external-store';
import { applyStoredState, revisionOf, type SegmentRevision } from './segment-revision';

/**
 * In-memory cache of opened projects. The setup screen, the reader and a running translation job
 * share the same mutable Project object; `touch` bumps a version so subscribed views re-render.
 * Every change is persisted through the repository in call order (one write chain per project).
 * Other tabs are told about segment changes (see cross-tab-channel) and re-read them from storage.
 */
export interface ProjectEntry {
  project?: Project;
  error?: string;
  loading: boolean;
  version: number;
}

const entries = new Map<string, ProjectEntry>();
const listeners = new Set<() => void>();
const writeChains = new Map<string, Promise<unknown>>();
const EMPTY: ProjectEntry = { loading: true, version: 0 };

/** Bumped whenever any book changes so the library list can refresh its counts. */
export const libraryVersion = createExternalStore(0);

function setEntry(id: string, entry: ProjectEntry): void {
  entries.set(id, entry);
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs persistence writes for one project strictly in order; the returned promise rejects on failure. */
export function enqueueWrite(projectId: string, write: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  writeChains.set(projectId, next);
  return next;
}

export function touchProject(id: string): void {
  const entry = entries.get(id);
  if (entry) setEntry(id, { ...entry, version: entry.version + 1 });
  libraryVersion.set(libraryVersion.get() + 1);
}

const inFlightLoads = new Map<string, Promise<void>>();

/** Loads a project into the cache once; concurrent callers share the same load. */
function load(id: string): Promise<void> {
  const pending = inFlightLoads.get(id);
  if (pending) return pending;
  setEntry(id, { loading: true, version: 0 });
  const promise = repository
    .loadProject(id)
    .then(
      (project) => {
        watchProjectChannel(id);
        setEntry(id, { project, loading: false, version: 1 });
      },
      (err: unknown) => setEntry(id, { error: err instanceof Error ? err.message : String(err), loading: false, version: 0 }),
    )
    .finally(() => inFlightLoads.delete(id));
  inFlightLoads.set(id, promise);
  return promise;
}

/** Subscribes to a project, loading it from IndexedDB on first use. */
export function useProject(id: string): ProjectEntry {
  useEffect(() => {
    if (!entries.has(id)) void load(id);
  }, [id]);
  return useSyncExternalStore(subscribe, () => entries.get(id) ?? EMPTY);
}

/** Returns the live in-memory project, loading it when needed. */
export async function ensureProject(id: string): Promise<Project> {
  const cached = entries.get(id)?.project;
  if (cached) return cached;
  await load(id);
  const entry = entries.get(id);
  if (!entry?.project) throw new Error(entry?.error ?? `Project ${id} not found`);
  return entry.project;
}

/** Registers a freshly imported project and persists it. */
export async function addProject(project: Project): Promise<void> {
  await enqueueWrite(project.id, () => repository.saveProject(project));
  watchProjectChannel(project.id);
  setEntry(project.id, { project, loading: false, version: 1 });
  libraryVersion.set(libraryVersion.get() + 1);
}

export async function removeProject(id: string): Promise<void> {
  await enqueueWrite(id, () => repository.deleteProject(id));
  closeProjectChannel(id);
  entries.delete(id);
  for (const l of [...listeners]) l();
  libraryVersion.set(libraryVersion.get() + 1);
}

/** Applies a settings patch in memory immediately and persists it. */
export function updateSettings(project: Project, patch: Partial<ProjectSettings>): Promise<void> {
  project.settings = { ...project.settings, ...patch };
  project.updatedAt = new Date().toISOString();
  touchProject(project.id);
  const snapshot = project.settings;
  return enqueueWrite(project.id, () => repository.saveSettings(project.id, snapshot));
}

const findSegment = (project: Project, segmentId: string): Segment | undefined => {
  for (const chapter of project.chapters) {
    const found = chapter.segments.find((s) => s.id === segmentId);
    if (found) return found;
  }
  return undefined;
};

/** Persists one segment (a copy, since core keeps mutating the live object during a run). */
export function persistSegment(projectId: string, segment: Segment): Promise<void> {
  const snapshot: Segment = { ...segment };
  return enqueueWrite(projectId, async () => {
    await repository.saveSegment(projectId, snapshot);
    broadcast(projectId, { type: 'segment', segmentId: snapshot.id });
  });
}

/**
 * The state a translation job last saw in storage for each segment: what the project held when the job
 * started, advanced by the job's own successful writes. Compare-and-set writes are checked against it.
 */
export type JobBaseline = Map<string, SegmentRevision>;

export function createJobBaseline(project: Project): JobBaseline {
  return new Map(project.chapters.flatMap((c) => c.segments.map((s) => [s.id, revisionOf(s)] as const)));
}

/**
 * Persists a segment finished by a translation job, unless its stored state changed since the job's
 * baseline (an edit or retranslation saved meanwhile, possibly from another tab). In that case the stored
 * state is kept and copied into the job's live segment, so storage and every view agree on it.
 */
export function persistJobSegment(project: Project, segment: Segment, baseline: JobBaseline): Promise<void> {
  const snapshot: Segment = { ...segment };
  const produced = revisionOf(snapshot);
  return enqueueWrite(project.id, async () => {
    const result = await repository.saveSegmentIfUnchanged(project.id, snapshot, baseline.get(snapshot.id) ?? { status: 'pending' });
    if (result.saved) {
      baseline.set(snapshot.id, produced);
      broadcast(project.id, { type: 'segment', segmentId: snapshot.id });
    } else if (applyStoredState(segment, produced, result.stored)) {
      touchProject(project.id);
    }
  });
}

/**
 * Another tab changed a segment of a project open here: re-read it from storage. The read is queued behind
 * this tab's pending writes, and a live segment changed locally in the meantime is left to its own write.
 */
onCrossTabMessage((projectId, message) => {
  if (message.type !== 'segment') return;
  const project = entries.get(projectId)?.project;
  const segment = project && findSegment(project, message.segmentId);
  if (!segment) return;
  const since = revisionOf(segment);
  enqueueWrite(projectId, async () => {
    const stored = await repository.loadSegmentState(projectId, segment.id);
    if (applyStoredState(segment, since, stored)) touchProject(projectId);
  }).catch((err: unknown) => console.warn('epubtrans: could not refresh a segment changed in another tab', err));
});

/** Saves a manual edit of a translation. An empty edit resets the segment to pending. */
export function saveTranslationEdit(project: Project, segment: Segment, html: string): Promise<void> {
  const value = html.trim();
  if (value === (segment.translationHtml ?? '')) return Promise.resolve();
  if (value) {
    segment.translationHtml = value;
    segment.status = segment.status === 'reviewed' ? 'reviewed' : 'translated';
  } else {
    delete segment.translationHtml;
    segment.status = 'pending';
  }
  delete segment.error;
  project.updatedAt = new Date().toISOString();
  touchProject(project.id);
  return persistSegment(project.id, segment);
}

/** Persists the passages picked by a sample translation (the in-memory project already carries them). */
export function persistLastSample(projectId: string, selection: SampleSelection): Promise<void> {
  const snapshot: SampleSelection = { seed: selection.seed, passages: selection.passages.map((p) => ({ ...p, segmentIds: [...p.segmentIds] })) };
  return enqueueWrite(projectId, () => repository.saveLastSample(projectId, snapshot));
}
