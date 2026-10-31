import 'fake-indexeddb/auto';
import { createDefaultSettings, type Project, type Segment } from '@epubtrans/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repository } from '../src/lib/app-services';
import { ProjectDatabase } from '../src/lib/project-database';
import { createProjectRepository, type ProjectRepository } from '../src/lib/project-repository';
import { addProject, createJobBaseline, persistJobSegment, removeProject } from '../src/lib/project-store';
import { applyStoredState, canOverwrite, isSegmentStateRow, revisionOf } from '../src/lib/segment-revision';

function makeProject(id: string): Project {
  const now = new Date('2026-10-30T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id,
    title: 'Book',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({ targetLang: 'vi' }),
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [
      {
        href: 'ch1.xhtml',
        title: 'Chapter 1',
        segments: [
          { id: 'c1-0', sourceHtml: 'Hello', sourceText: 'Hello', status: 'pending' },
          { id: 'c1-1', sourceHtml: 'World', sourceText: 'World', status: 'translated', translationHtml: 'Thế giới' },
        ],
      },
    ],
  };
}

const segmentOf = (project: Project, index: number): Segment => {
  const s = project.chapters[0]?.segments[index];
  if (!s) throw new Error('fixture');
  return s;
};

describe('segment revisions', () => {
  it('treats a missing row as a pristine pending segment', () => {
    expect(revisionOf(undefined)).toEqual({ status: 'pending' });
    expect(canOverwrite(undefined, { status: 'pending' })).toBe(true);
    expect(canOverwrite(undefined, { status: 'translated', translationHtml: 'x' })).toBe(false);
  });

  it('allows an overwrite only while status and translation match the expected state', () => {
    const row = { projectId: 'p', id: 's', status: 'translated' as const, translationHtml: 'a' };
    expect(canOverwrite(row, { status: 'translated', translationHtml: 'a' })).toBe(true);
    expect(canOverwrite(row, { status: 'translated', translationHtml: 'b' })).toBe(false);
    expect(canOverwrite(row, { status: 'reviewed', translationHtml: 'a' })).toBe(false);
    expect(canOverwrite(row, { status: 'pending' })).toBe(false);
  });

  it('copies the stored state into a live segment unless it changed since', () => {
    const segment: Segment = { id: 's', sourceHtml: 'x', sourceText: 'x', status: 'translated', translationHtml: 'job', error: 'old' };
    const since = revisionOf(segment);
    expect(applyStoredState(segment, since, { projectId: 'p', id: 's', status: 'translated', translationHtml: 'edit' })).toBe(true);
    expect(segment).toEqual({ id: 's', sourceHtml: 'x', sourceText: 'x', status: 'translated', translationHtml: 'edit' });

    // A newer local change wins over the stored state.
    expect(applyStoredState(segment, since, undefined)).toBe(false);
    expect(segment.translationHtml).toBe('edit');

    expect(applyStoredState(segment, revisionOf(segment), undefined)).toBe(true);
    expect(segment).toEqual({ id: 's', sourceHtml: 'x', sourceText: 'x', status: 'pending' });
  });

  it('copies the hand-edit flag from another tab, also when the translation itself is unchanged', () => {
    const segment: Segment = { id: 's', sourceHtml: 'x', sourceText: 'x', status: 'translated', translationHtml: 'job' };
    const row = { projectId: 'p', id: 's', status: 'translated' as const, translationHtml: 'mine', userEdited: true };
    expect(applyStoredState(segment, revisionOf(segment), row)).toBe(true);
    expect(segment).toMatchObject({ translationHtml: 'mine', userEdited: true });

    // Same text, flag cleared elsewhere (e.g. retranslated to the same words): the flag still follows storage.
    expect(applyStoredState(segment, revisionOf(segment), { ...row, userEdited: undefined })).toBe(true);
    expect(segment).not.toHaveProperty('userEdited');
    expect(applyStoredState(segment, revisionOf(segment), row)).toBe(true);
    expect(segment.userEdited).toBe(true);
  });

  it('validates rows read from storage', () => {
    expect(isSegmentStateRow({ projectId: 'p', id: 's', status: 'reviewed', translationHtml: 'x' })).toBe(true);
    expect(isSegmentStateRow({ projectId: 'p', id: 's', status: 'bogus' })).toBe(false);
    expect(isSegmentStateRow({ projectId: 'p', id: 's', status: 'translated', translationHtml: 3 })).toBe(false);
    expect(isSegmentStateRow(null)).toBe(false);
  });
});

describe('repository.saveSegmentIfUnchanged', () => {
  let db: ProjectDatabase;
  let repo: ProjectRepository;

  beforeEach(async () => {
    db = new ProjectDatabase(`cas-${Math.random()}`);
    repo = createProjectRepository(db);
    await repo.saveProject(makeProject('p1'));
  });

  afterEach(async () => {
    await db.delete();
  });

  it('writes when the stored state still equals the expected one', async () => {
    const result = await repo.saveSegmentIfUnchanged(
      'p1',
      { id: 'c1-0', sourceHtml: 'Hello', sourceText: 'Hello', status: 'translated', translationHtml: 'Xin chào' },
      { status: 'pending' },
    );
    expect(result).toEqual({ saved: true });
    expect(await repo.loadSegmentState('p1', 'c1-0')).toEqual({ projectId: 'p1', id: 'c1-0', status: 'translated', translationHtml: 'Xin chào' });
  });

  it('keeps a concurrent edit and returns it', async () => {
    const edit: Segment = { id: 'c1-0', sourceHtml: 'Hello', sourceText: 'Hello', status: 'translated', translationHtml: 'Bản sửa' };
    await repo.saveSegment('p1', edit);
    const result = await repo.saveSegmentIfUnchanged('p1', { ...edit, translationHtml: 'Bản dịch máy' }, { status: 'pending' });
    expect(result).toEqual({ saved: false, stored: { projectId: 'p1', id: 'c1-0', status: 'translated', translationHtml: 'Bản sửa' } });
    expect((await repo.loadSegmentState('p1', 'c1-0'))?.translationHtml).toBe('Bản sửa');
  });

  it('keeps a segment reset to pending meanwhile', async () => {
    await repo.saveSegment('p1', { id: 'c1-1', sourceHtml: 'World', sourceText: 'World', status: 'pending' });
    const result = await repo.saveSegmentIfUnchanged(
      'p1',
      { id: 'c1-1', sourceHtml: 'World', sourceText: 'World', status: 'reviewed', translationHtml: 'Thế giới!' },
      { status: 'translated', translationHtml: 'Thế giới' },
    );
    expect(result).toEqual({ saved: false, stored: undefined });
    expect(await repo.loadSegmentState('p1', 'c1-1')).toBeUndefined();
  });

  it('rejects a corrupted stored row instead of comparing against it', async () => {
    await db.segments.put({ projectId: 'p1', id: 'c1-0', status: 'bogus' as never });
    await expect(repo.saveSegmentIfUnchanged('p1', segmentOf(makeProject('p1'), 0), { status: 'pending' })).rejects.toThrow(/Invalid segment state/);
  });
});

describe('persistJobSegment', () => {
  const id = 'job-p1';
  afterEach(async () => {
    await removeProject(id);
  });

  it('persists job results and advances the baseline for later passes', async () => {
    const project = makeProject(id);
    await addProject(project);
    const baseline = createJobBaseline(project);
    const segment = segmentOf(project, 0);
    Object.assign(segment, { status: 'translated', translationHtml: 'Xin chào' });
    await persistJobSegment(project, segment, baseline);
    expect(baseline.get('c1-0')).toEqual({ status: 'translated', translationHtml: 'Xin chào' });

    Object.assign(segment, { status: 'reviewed', translationHtml: 'Xin chào!' });
    await persistJobSegment(project, segment, baseline);
    expect(await repository.loadSegmentState(id, 'c1-0')).toMatchObject({ status: 'reviewed', translationHtml: 'Xin chào!' });
  });

  it('keeps an edit saved by another tab and updates the job segment from storage', async () => {
    const project = makeProject(id);
    await addProject(project);
    const baseline = createJobBaseline(project);
    // Another tab saves an edit after this job took its baseline.
    await repository.saveSegment(id, { id: 'c1-0', sourceHtml: 'Hello', sourceText: 'Hello', status: 'translated', translationHtml: 'Bản sửa' });

    const segment = segmentOf(project, 0);
    Object.assign(segment, { status: 'translated', translationHtml: 'Bản dịch máy' });
    await persistJobSegment(project, segment, baseline);

    expect(await repository.loadSegmentState(id, 'c1-0')).toMatchObject({ status: 'translated', translationHtml: 'Bản sửa' });
    expect(segment.translationHtml).toBe('Bản sửa');
    expect(baseline.get('c1-0')).toEqual({ status: 'pending' });
  });
});
