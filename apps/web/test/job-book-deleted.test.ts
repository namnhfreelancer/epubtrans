import 'fake-indexeddb/auto';
import { type ChatProvider, createDefaultSettings, type Project } from '@epubtrans/core';
import { afterEach, describe, expect, it } from 'vitest';
import { database, repository } from '../src/lib/app-services';
import { addProject, removeProject } from '../src/lib/project-store';
import { getJobState, isJobActive, startJob } from '../src/lib/translation-jobs';

/** Three segments of ~1000 source tokens each: with the 1500-token batch budget that is three requests. */
function makeProject(id: string): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
  const text = (n: number) => String(n).repeat(4000);
  return {
    schemaVersion: 1,
    id,
    title: 'Book',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({ targetLang: 'vi', concurrency: 1, model: 'm' }),
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [
      {
        href: 'ch1.xhtml',
        title: 'Chapter 1',
        segments: [1, 2, 3].map((n) => ({ id: `s${n}`, sourceHtml: text(n), sourceText: text(n), status: 'pending' as const })),
      },
    ],
  };
}

/** A provider whose first answer is held until `release()` is called; later answers take a few ms, like a network. */
function gatedProvider() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[][] = [];
  const provider: ChatProvider = {
    listModels: async () => ['m'],
    chat: async (req) => {
      const { segments } = JSON.parse(req.user) as { segments: { id: string; html: string }[] };
      requests.push(segments.map((s) => s.id));
      if (requests.length === 1) await gate;
      else await new Promise((r) => setTimeout(r, 25));
      return { text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: `Dịch ${s.html.slice(0, 3)}` })) }) };
    },
  };
  return { provider, release, requests };
}

const settled = async (id: string) => {
  const deadline = Date.now() + 10_000;
  while (isJobActive(id)) {
    if (Date.now() > deadline) throw new Error('job did not settle');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('a translation job whose book is deleted meanwhile', () => {
  afterEach(async () => {
    await database.segments.clear();
  });

  it('aborts without writing orphan rows or sending more requests', async () => {
    const id = 'deleted-mid-job';
    const project = makeProject(id);
    await addProject(project);
    const { provider, release, requests } = gatedProvider();

    expect(await startJob(project, (book) => book, provider)).toBe('started');
    await expect.poll(() => requests.length).toBe(1);

    // Another tab deletes the book while the first request is in flight (this tab's job knows nothing of it).
    await repository.deleteProject(id);
    release();
    await settled(id);

    expect(getJobState(id).status).toBe('aborted');
    // Only the request already started when the first write failed may still be in flight; the third is never sent.
    expect(requests.length).toBeLessThan(3);
    expect(await database.segments.where('projectId').equals(id).count()).toBe(0);
    expect(await database.projects.get(id)).toBeUndefined();
    await removeProject(id);
  });

  it('does not start translating a book that is already gone', async () => {
    const id = 'deleted-before-job';
    const project = makeProject(id);
    await addProject(project);
    await repository.deleteProject(id);
    const { provider, requests } = gatedProvider();

    await startJob(project, (book) => book, provider);
    await settled(id);

    expect(getJobState(id).status).toBe('aborted');
    expect(requests).toHaveLength(0);
    expect(await database.segments.count()).toBe(0);
    await removeProject(id);
  });

  it('rejects a late segment write for a deleted project instead of recreating rows', async () => {
    const segment = { id: 's1', sourceHtml: 'x', sourceText: 'x', status: 'translated' as const, translationHtml: 'y' };
    await expect(repository.saveSegment('gone', segment)).rejects.toThrow(/not found/);
    await expect(repository.saveSegmentIfUnchanged('gone', { ...segment, status: 'reviewed' }, { status: 'translated', translationHtml: 'y' })).rejects.toThrow(
      /not found/,
    );
    expect(await database.segments.count()).toBe(0);
  });
});
