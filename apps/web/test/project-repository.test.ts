import 'fake-indexeddb/auto';
import { createDefaultSettings, type Project } from '@epubtrans/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '../src/lib/project-database';
import { createProjectRepository, ProjectNotFoundError, type ProjectRepository } from '../src/lib/project-repository';

function makeProject(id = 'p1'): Project {
  const now = new Date('2026-10-30T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id,
    title: 'A Modest Proposal',
    author: 'Jonathan Swift',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({ targetLang: 'vi' }),
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [
      {
        href: 'ch1.xhtml',
        title: 'Chapter 1',
        segments: [
          { id: 'c1-0', sourceHtml: '<b>Hello</b>', sourceText: 'Hello', status: 'pending' },
          { id: 'c1-1', sourceHtml: 'World', sourceText: 'World', status: 'translated', translationHtml: 'Thế giới' },
          { id: 'c1-2', sourceHtml: 'Again', sourceText: 'Again', status: 'error', error: 'HTTP 500' },
        ],
      },
    ],
  };
}

let db: ProjectDatabase;
let repo: ProjectRepository;

beforeEach(() => {
  db = new ProjectDatabase(`test-${Math.random()}`);
  repo = createProjectRepository(db);
});

afterEach(async () => {
  await db.delete();
});

describe('project repository', () => {
  it('round-trips a project including translation state and source bytes', async () => {
    const project = makeProject();
    await repo.saveProject(project);
    const loaded = await repo.loadProject('p1');
    expect(loaded).toEqual(project);
    expect(loaded.sourceEpub).toBeInstanceOf(Uint8Array);
  });

  it('persists each finished segment so a reload resumes from it', async () => {
    const project = makeProject();
    await repo.saveProject(project);
    const seg = project.chapters[0]?.segments[0];
    if (!seg) throw new Error('fixture');
    seg.status = 'translated';
    seg.translationHtml = '<b>Xin chào</b>';
    await repo.saveSegment('p1', seg);

    const loaded = await repo.loadProject('p1');
    expect(loaded.chapters[0]?.segments[0]).toEqual({
      id: 'c1-0',
      sourceHtml: '<b>Hello</b>',
      sourceText: 'Hello',
      status: 'translated',
      translationHtml: '<b>Xin chào</b>',
    });
    expect(loaded.chapters[0]?.segments.filter((s) => s.status === 'pending' || s.status === 'error').map((s) => s.id)).toEqual(['c1-2']);
  });

  it('resets a segment to pending without resurrecting an older translation', async () => {
    const project = makeProject();
    await repo.saveProject(project);
    await repo.saveSegment('p1', { id: 'c1-1', sourceHtml: 'World', sourceText: 'World', status: 'pending' });
    const loaded = await repo.loadProject('p1');
    expect(loaded.chapters[0]?.segments[1]).toEqual({ id: 'c1-1', sourceHtml: 'World', sourceText: 'World', status: 'pending' });
  });

  it('clears a previous error when a segment succeeds', async () => {
    await repo.saveProject(makeProject());
    await repo.saveSegment('p1', { id: 'c1-2', sourceHtml: 'Again', sourceText: 'Again', status: 'translated', translationHtml: 'Lần nữa' });
    const loaded = await repo.loadProject('p1');
    expect(loaded.chapters[0]?.segments[2]).toEqual({ id: 'c1-2', sourceHtml: 'Again', sourceText: 'Again', status: 'translated', translationHtml: 'Lần nữa' });
  });

  it('lists summaries with progress counts', async () => {
    await repo.saveProject(makeProject('p1'));
    await repo.saveSegment('p1', { id: 'c1-0', sourceHtml: '', sourceText: '', status: 'reviewed', translationHtml: 'x' });
    const [summary] = await repo.listProjects();
    expect(summary).toMatchObject({ id: 'p1', title: 'A Modest Proposal', author: 'Jonathan Swift', total: 3, done: 2, errors: 1, targetLang: 'vi' });
  });

  it('saves settings separately from chapters', async () => {
    await repo.saveProject(makeProject());
    await repo.saveSettings('p1', createDefaultSettings({ targetLang: 'fr', concurrency: 5 }));
    const loaded = await repo.loadProject('p1');
    expect(loaded.settings.targetLang).toBe('fr');
    expect(loaded.settings.concurrency).toBe(5);
    await expect(repo.saveSettings('missing', createDefaultSettings())).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('replacing a project drops stale segment state', async () => {
    const project = makeProject();
    await repo.saveProject(project);
    const fresh = makeProject();
    for (const s of fresh.chapters[0]?.segments ?? []) {
      s.status = 'pending';
      delete s.translationHtml;
      delete s.error;
    }
    await repo.saveProject(fresh);
    const loaded = await repo.loadProject('p1');
    expect(loaded.chapters[0]?.segments.every((s) => s.status === 'pending' && s.translationHtml === undefined)).toBe(true);
  });

  it('deletes every table row of a project', async () => {
    await repo.saveProject(makeProject('p1'));
    await repo.saveProject(makeProject('p2'));
    await repo.deleteProject('p1');
    expect(await repo.exists('p1')).toBe(false);
    await expect(repo.loadProject('p1')).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await db.segments.where('projectId').equals('p1').count()).toBe(0);
    expect((await repo.listProjects()).map((p) => p.id)).toEqual(['p2']);
  });

  it('rejects corrupted rows through core validation', async () => {
    await repo.saveProject(makeProject());
    await db.segments.put({ projectId: 'p1', id: 'c1-0', status: 'bogus' as never });
    await expect(repo.loadProject('p1')).rejects.toThrow(/status/);
  });
});
