import { type Project, type ProjectSettings, type SampleSelection, type Segment, validateProjectState } from '@epubtrans/core';
import type { ProjectDatabase, ProjectMetaRow, SegmentStateRow } from './project-database';
import { canOverwrite, isSegmentStateRow, type SegmentRevision } from './segment-revision';

export interface ProjectSummary {
  id: string;
  title: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  targetLang: string;
  total: number;
  /** Segments translated or reviewed. */
  done: number;
  errors: number;
}

export class ProjectNotFoundError extends Error {
  override readonly name = 'ProjectNotFoundError';
}

const toStateRow = (projectId: string, s: Segment): SegmentStateRow => ({
  projectId,
  id: s.id,
  status: s.status,
  ...(s.translationHtml !== undefined ? { translationHtml: s.translationHtml } : {}),
  ...(s.error !== undefined ? { error: s.error } : {}),
  ...(s.userEdited ? { userEdited: true } : {}),
});

function applyState(s: Segment, row: SegmentStateRow | undefined): Segment {
  if (!row) return s;
  const { translationHtml, error, userEdited: _stale, ...rest } = s;
  return {
    ...rest,
    status: row.status,
    ...(row.translationHtml !== undefined ? { translationHtml: row.translationHtml } : {}),
    ...(row.error !== undefined ? { error: row.error } : {}),
    ...(row.userEdited ? { userEdited: true } : {}),
  };
}

/** Outcome of a compare-and-set segment write; `stored` is the state that was kept when the write lost. */
export type ConditionalSaveResult = { saved: true } | { saved: false; stored: SegmentStateRow | undefined };

const isDone = (status: string) => status === 'translated' || status === 'reviewed';

function validRow(row: unknown): SegmentStateRow | undefined {
  if (row === undefined) return undefined;
  if (!isSegmentStateRow(row)) throw new Error('Invalid segment state in storage');
  return row;
}

/** Persistence helpers over {@link ProjectDatabase}. All data read back is validated with core's schema. */
export function createProjectRepository(db: ProjectDatabase) {
  /**
   * Writes (or clears) one overlay row; must run inside a rw transaction over projects + segments.
   * Throws (rolling the transaction back) when the project is gone, e.g. deleted in another tab, so a
   * late writer can never leave segment rows behind for a book that no longer exists.
   */
  async function writeSegment(projectId: string, segment: Segment): Promise<void> {
    const touched = await db.projects.update(projectId, { updatedAt: new Date().toISOString() });
    if (!touched) throw new ProjectNotFoundError(`Project ${projectId} not found`);
    if (segment.status === 'pending' && segment.translationHtml === undefined) await db.segments.delete([projectId, segment.id]);
    else await db.segments.put(toStateRow(projectId, segment));
  }

  return {
    /** Stores a newly imported project (or replaces one with the same id). */
    async saveProject(project: Project): Promise<void> {
      const { chapters, sourceEpub, ...meta } = project;
      const segments = chapters.flatMap((c) => c.segments);
      // The chapter row only keeps the source; translation state lives in the overlay table.
      const pristine = chapters.map((c) => ({
        ...c,
        segments: c.segments.map((s): Segment => ({ id: s.id, sourceHtml: s.sourceHtml, sourceText: s.sourceText, status: 'pending' })),
      }));
      await db.transaction('rw', [db.projects, db.chapters, db.sources, db.segments], async () => {
        await db.segments.where('projectId').equals(project.id).delete();
        await db.projects.put({ ...meta, segmentCount: segments.length });
        await db.chapters.put({ projectId: project.id, chapters: pristine });
        await db.sources.put({ projectId: project.id, bytes: sourceEpub });
        await db.segments.bulkPut(segments.filter((s) => s.status !== 'pending').map((s) => toStateRow(project.id, s)));
      });
    },

    async loadProject(id: string): Promise<Project> {
      const [meta, chaptersRow, source, states] = await db.transaction('r', [db.projects, db.chapters, db.sources, db.segments], () =>
        Promise.all([db.projects.get(id), db.chapters.get(id), db.sources.get(id), db.segments.where('projectId').equals(id).toArray()]),
      );
      if (!meta || !chaptersRow || !source) throw new ProjectNotFoundError(`Project ${id} not found`);
      const byId = new Map(states.map((s) => [s.id, s]));
      const { segmentCount: _count, ...state } = meta;
      const chapters = chaptersRow.chapters.map((c) => ({ ...c, segments: c.segments.map((s) => applyState(s, byId.get(s.id))) }));
      if (!(source.bytes instanceof Uint8Array)) throw new Error(`Project ${id} has no source book`);
      return { ...validateProjectState({ ...state, chapters }), sourceEpub: source.bytes };
    },

    async listProjects(): Promise<ProjectSummary[]> {
      const metas = await db.projects.orderBy('updatedAt').reverse().toArray();
      return Promise.all(
        metas.map(async (m: ProjectMetaRow): Promise<ProjectSummary> => {
          const states = await db.segments.where('projectId').equals(m.id).toArray();
          return {
            id: m.id,
            title: m.title,
            ...(m.author ? { author: m.author } : {}),
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
            targetLang: m.settings.targetLang,
            total: m.segmentCount,
            done: states.filter((s) => isDone(s.status)).length,
            errors: states.filter((s) => s.status === 'error').length,
          };
        }),
      );
    },

    async saveSettings(id: string, settings: ProjectSettings): Promise<void> {
      const updated = await db.projects.update(id, { settings, updatedAt: new Date().toISOString() });
      if (!updated) throw new ProjectNotFoundError(`Project ${id} not found`);
    },

    /** Remembers the passages of the last sample translation so the viewer and "translate again" survive a reload. */
    async saveLastSample(id: string, lastSample: SampleSelection): Promise<void> {
      const updated = await db.projects.update(id, { lastSample, updatedAt: new Date().toISOString() });
      if (!updated) throw new ProjectNotFoundError(`Project ${id} not found`);
    },

    /** Persists one segment's translation state (called as soon as a segment finishes or is edited). */
    async saveSegment(projectId: string, segment: Segment): Promise<void> {
      await db.transaction('rw', [db.projects, db.segments], () => writeSegment(projectId, segment));
    },

    /**
     * Compare-and-set: persists the segment only if the stored state still equals `expected` (the state the
     * writer based its change on). Read and write share one IndexedDB transaction, which IndexedDB serializes
     * against writes from other tabs, so a concurrent edit is never overwritten. Rejects with
     * {@link ProjectNotFoundError} when the project was deleted meanwhile.
     */
    async saveSegmentIfUnchanged(projectId: string, segment: Segment, expected: SegmentRevision): Promise<ConditionalSaveResult> {
      return db.transaction('rw', [db.projects, db.segments], async (): Promise<ConditionalSaveResult> => {
        // A deleted book has no segment rows either, which would look like "unchanged": fail instead.
        if (!(await db.projects.get(projectId))) throw new ProjectNotFoundError(`Project ${projectId} not found`);
        const stored = validRow(await db.segments.get([projectId, segment.id]));
        if (!canOverwrite(stored, expected)) return { saved: false, stored };
        await writeSegment(projectId, segment);
        return { saved: true };
      });
    },

    /** Reads one segment's stored translation state (undefined for a pristine pending segment). */
    async loadSegmentState(projectId: string, segmentId: string): Promise<SegmentStateRow | undefined> {
      return validRow(await db.segments.get([projectId, segmentId]));
    },

    async exists(id: string): Promise<boolean> {
      return (await db.projects.get(id)) !== undefined;
    },

    async deleteProject(id: string): Promise<void> {
      await db.transaction('rw', [db.projects, db.chapters, db.sources, db.segments], async () => {
        await db.segments.where('projectId').equals(id).delete();
        await db.projects.delete(id);
        await db.chapters.delete(id);
        await db.sources.delete(id);
      });
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
