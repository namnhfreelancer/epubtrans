import type { Chapter, Project, SegmentStatus, WordHintEntry } from '@epubtrans/core';
import { Dexie, type Table } from 'dexie';

/**
 * IndexedDB layout. A project is split so frequent writes stay small:
 * - `projects`: metadata + settings (rewritten on every settings change),
 * - `chapters`: imported chapter structure (written once per import),
 * - `sources`: the normalized EPUB bytes (written once per import),
 * - `segments`: per-segment translation state overlay (one small row per finished/edited segment),
 * - `hints` (version 2): one row per glossed Word Wise lemma, written as a hints run finishes it.
 * Every segment that is not 'pending' has an overlay row, so progress counts never need the chapters.
 * The project row keeps the language pair of the hints (`hintLanguages`); the entries live in `hints`.
 */
export type ProjectMetaRow = Omit<Project, 'chapters' | 'sourceEpub' | 'wordHints'> & {
  segmentCount: number;
  hintLanguages?: { sourceLang: string; glossLang: string };
};

export type HintRow = WordHintEntry & { projectId: string };

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
}

export class ProjectDatabase extends Dexie {
  projects!: Table<ProjectMetaRow, string>;
  chapters!: Table<ChaptersRow, string>;
  sources!: Table<SourceRow, string>;
  segments!: Table<SegmentStateRow, [string, string]>;
  hints!: Table<HintRow, [string, string]>;

  constructor(name = 'epubtrans') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      chapters: 'projectId',
      sources: 'projectId',
      segments: '[projectId+id], projectId',
    });
    this.version(2).stores({ hints: '[projectId+lemma], projectId' });
  }
}
