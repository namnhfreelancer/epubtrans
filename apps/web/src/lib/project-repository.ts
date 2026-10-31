import { type Project, type ProjectSettings, type SampleSelection, type Segment, validateProjectState } from '@epubtrans/core';
import type { ProjectDatabase, ProjectMetaRow, SegmentStateRow } from './project-database';

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
});

function applyState(s: Segment, row: SegmentStateRow | undefined): Segment {
  if (!row) return s;
  const { translationHtml, error, ...rest } = s;
  return {
    ...rest,
    status: row.status,
    ...(row.translationHtml !== undefined ? { translationHtml: row.translationHtml } : {}),
    ...(row.error !== undefined ? { error: row.error } : {}),
  };
}

const isDone = (status: string) => status === 'translated' || status === 'reviewed';

/** Persistence helpers over {@link ProjectDatabase}. All data read back is validated with core's schema. */
export function createProjectRepository(db: ProjectDatabase) {
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
      await db.transaction('rw', [db.projects, db.segments], async () => {
        if (segment.status === 'pending' && segment.translationHtml === undefined) await db.segments.delete([projectId, segment.id]);
        else await db.segments.put(toStateRow(projectId, segment));
        await db.projects.update(projectId, { updatedAt: new Date().toISOString() });
      });
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
