import type { Chapter, Project, SegmentStatus } from '@epubtrans/core';
import { Dexie, type Table } from 'dexie';

/**
 * IndexedDB layout. A project is split so frequent writes stay small:
 * - `projects`: metadata + settings (rewritten on every settings change),
 * - `chapters`: imported chapter structure (written once per import),
 * - `sources`: the normalized EPUB bytes (written once per import),
 * - `segments`: per-segment translation state overlay (one small row per finished/edited segment).
 * Every segment that is not 'pending' has an overlay row, so progress counts never need the chapters.
 */
export type ProjectMetaRow = Omit<Project, 'chapters' | 'sourceEpub'> & { segmentCount: number };

export interface ChaptersRow {
  projectId: string;
  chapters: Chapter[];
}

export interface SourceRow {
  projectId: string;
  bytes: Uint8Array;
}

export interface SegmentStateRow {
  projectId: string;
  id: string;
  status: SegmentStatus;
  translationHtml?: string;
  error?: string;
  /** The user saved this translation by hand (kept apart from machine output). */
  userEdited?: boolean;
}

export class ProjectDatabase extends Dexie {
  projects!: Table<ProjectMetaRow, string>;
  chapters!: Table<ChaptersRow, string>;
  sources!: Table<SourceRow, string>;
  segments!: Table<SegmentStateRow, [string, string]>;

  constructor(name = 'epubtrans') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      chapters: 'projectId',
      sources: 'projectId',
      segments: '[projectId+id], projectId',
    });
  }
}
