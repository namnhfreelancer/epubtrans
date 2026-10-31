import 'fake-indexeddb/auto';
import { createDefaultSettings, type Project } from '@epubtrans/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectDatabase } from '../src/lib/project-database';
import { createProjectRepository, ProjectNotFoundError, type ProjectRepository } from '../src/lib/project-repository';

const project: Project = {
  schemaVersion: 1,
  id: 'p1',
  title: 'Book',
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  settings: createDefaultSettings({ targetLang: 'vi' }),
  sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
  chapters: [{ href: 'c1.xhtml', title: 'One', segments: [{ id: 'c1-0', sourceHtml: 'Hi', sourceText: 'Hi', status: 'pending' }] }],
};

let db: ProjectDatabase;
let repo: ProjectRepository;
beforeEach(() => {
  db = new ProjectDatabase(`test-${Math.random()}`);
  repo = createProjectRepository(db);
});
afterEach(async () => {
  await db.delete();
});

describe('last sample persistence', () => {
  it('stores the selection and loads it back; projects saved before it existed still load', async () => {
    await repo.saveProject(project);
    expect((await repo.loadProject('p1')).lastSample).toBeUndefined();

    const selection = { seed: 77, passages: [{ chapterHref: 'c1.xhtml', chapterTitle: 'One', segmentIds: ['c1-0'] }] };
    await repo.saveLastSample('p1', selection);
    expect((await repo.loadProject('p1')).lastSample).toEqual(selection);

    await expect(repo.saveLastSample('missing', selection)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('keeps the selection when a project is saved again with it', async () => {
    const selection = { seed: 1, passages: [{ chapterHref: 'c1.xhtml', chapterTitle: 'One', segmentIds: ['c1-0'] }] };
    await repo.saveProject({ ...project, lastSample: selection });
    expect((await repo.loadProject('p1')).lastSample).toEqual(selection);
  });
});
