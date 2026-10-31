import 'fake-indexeddb/auto';
import { type ChatProvider, createDefaultSettings, type Project, type Segment } from '@epubtrans/core';
import { afterEach, describe, expect, it } from 'vitest';
import { database, repository } from '../src/lib/app-services';
import { addProject, removeProject, saveTranslationEdit } from '../src/lib/project-store';
import { getSampleJobState, startSampleJob } from '../src/lib/sample-jobs';

function makeProject(id: string): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
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
        segments: [
          { id: 's1', sourceHtml: 'Text 1', sourceText: 'Text 1', status: 'translated', translationHtml: 'Cũ 1' },
          { id: 's2', sourceHtml: 'Text 2', sourceText: 'Text 2', status: 'translated', translationHtml: 'Cũ 2' },
        ],
      },
    ],
  };
}

const selection = { seed: 1, passages: [{ chapterHref: 'ch1.xhtml', chapterTitle: 'Chapter 1', segmentIds: ['s1', 's2'] }] };

/** Answers once `release()` is called; `inFlight` resolves when the request has arrived. */
function gatedProvider() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const provider: ChatProvider = {
    listModels: async () => ['m'],
    chat: async (req) => {
      const { segments } = JSON.parse(req.user) as { segments: { id: string; html: string }[] };
      arrived();
      await gate;
      return { text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: `Mẫu ${s.html}` })) }) };
    },
  };
  return { provider, release, inFlight };
}

describe('a sample run saves with compare-and-set', () => {
  afterEach(async () => {
    await database.segments.clear();
  });

  it('keeps an edit written to storage while the sample batch was in flight, and shows it in the live segment', async () => {
    const project = makeProject('sample-cas');
    await addProject(project);
    const { provider, release, inFlight } = gatedProvider();

    expect(await startSampleJob(project, (book) => book, provider, { selection })).toBe('started');
    await inFlight;
    // Written straight to storage (no broadcast), like an edit from another tab the sample never heard about.
    await database.segments.put({ projectId: project.id, id: 's1', status: 'translated', translationHtml: 'Bản sửa từ thẻ khác' });
    release();
    await expect.poll(() => getSampleJobState(project.id).status).toBe('done');

    expect(await repository.loadSegmentState(project.id, 's1')).toMatchObject({ status: 'translated', translationHtml: 'Bản sửa từ thẻ khác' });
    expect(project.chapters[0]?.segments[0]?.translationHtml).toBe('Bản sửa từ thẻ khác');
    // The untouched segment still takes the sample's answer, in storage and in memory.
    expect(await repository.loadSegmentState(project.id, 's2')).toMatchObject({ translationHtml: 'Mẫu Text 2' });
    expect(project.chapters[0]?.segments[1]?.translationHtml).toBe('Mẫu Text 2');
    await removeProject(project.id);
  });
});

describe('manual edits are flagged', () => {
  afterEach(async () => {
    await database.segments.clear();
  });

  it('saves userEdited with a hand-written translation and clears it when the segment is reset', async () => {
    const project = makeProject('user-edited');
    await addProject(project);
    const segment = project.chapters[0]?.segments[0] as Segment;

    await saveTranslationEdit(project, segment, 'Bản dịch của tôi');
    expect(segment.userEdited).toBe(true);
    expect(await database.segments.get([project.id, 's1'])).toMatchObject({ translationHtml: 'Bản dịch của tôi', userEdited: true });

    await saveTranslationEdit(project, segment, '');
    expect(segment.userEdited).toBeUndefined();
    expect(await database.segments.get([project.id, 's1'])).toBeUndefined();
    await removeProject(project.id);
  });
});
