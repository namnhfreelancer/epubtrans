import 'fake-indexeddb/auto';
import { type ChatProvider, createDefaultSettings, type Project, ProviderError } from '@epubtrans/core';
import { afterEach, describe, expect, it } from 'vitest';
import { database } from '../src/lib/app-services';
import { addProject, removeProject } from '../src/lib/project-store';
import { getSampleJobState, startSampleJob } from '../src/lib/sample-jobs';

/** Two translated segments plus one the user edited by hand, all in the stored sample. */
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
          { id: 's3', sourceHtml: 'Text 3', sourceText: 'Text 3', status: 'translated', translationHtml: 'Bản tôi sửa', userEdited: true },
        ],
      },
    ],
  };
}

const selection = { seed: 1, passages: [{ chapterHref: 'ch1.xhtml', chapterTitle: 'Chapter 1', segmentIds: ['s1', 's2', 's3'] }] };
const translations = (project: Project) => project.chapters[0]?.segments.map((s) => [s.id, s.status, s.translationHtml]);

async function runSample(project: Project, provider: ChatProvider) {
  await addProject(project);
  expect(await startSampleJob(project, (book) => book, provider, { selection })).toBe('started');
  await expect.poll(() => getSampleJobState(project.id).status, { timeout: 20_000 }).not.toBe('running');
  return getSampleJobState(project.id);
}

describe('the outcome of a sample run', () => {
  afterEach(async () => {
    await database.segments.clear();
  });

  it('ends as failed, without claiming success, when every segment it sent failed (provider outage)', async () => {
    const project = makeProject('sample-outage');
    let calls = 0;
    const outage: ChatProvider = {
      listModels: async () => ['m'],
      chat: async () => {
        calls++;
        throw new ProviderError('rate limited', 429, 0);
      },
    };
    const state = await runSample(project, outage);

    expect(calls).toBeGreaterThan(0);
    expect(state.status).toBe('failed');
    expect(state.error).toBeUndefined(); // not a stopped run: the UI explains that every segment failed
    expect([...state.failed].sort()).toEqual(['s1', 's2']);
    expect(state.keptEdited).toEqual(['s3']);
    // Earlier translations and the hand edit are untouched.
    expect(translations(project)).toEqual([
      ['s1', 'translated', 'Cũ 1'],
      ['s2', 'translated', 'Cũ 2'],
      ['s3', 'translated', 'Bản tôi sửa'],
    ]);
    await removeProject(project.id);
  });

  it('ends as done but lists the failed and the hand-edited segments when only some failed', async () => {
    const project = makeProject('sample-partial');
    const partial: ChatProvider = {
      listModels: async () => ['m'],
      chat: async (req) => {
        const { segments } = JSON.parse(req.user) as { segments: { id: string; html: string }[] };
        // s1 always gets forbidden markup, so validation rejects it on every attempt.
        return { text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: s.id === 's1' ? '<script>x()</script>' : `Mới ${s.html}` })) }) };
      },
    };
    const state = await runSample(project, partial);

    expect(state.status).toBe('done');
    expect(state.failed).toEqual(['s1']);
    expect(state.keptEdited).toEqual(['s3']);
    expect(translations(project)).toEqual([
      ['s1', 'translated', 'Cũ 1'],
      ['s2', 'translated', 'Mới Text 2'],
      ['s3', 'translated', 'Bản tôi sửa'],
    ]);
    await removeProject(project.id);
  });

  it('reports a clean run as done, listing only the hand-edited segments', async () => {
    const project = makeProject('sample-reset');
    const ok: ChatProvider = {
      listModels: async () => ['m'],
      chat: async (req) => {
        const { segments } = JSON.parse(req.user) as { segments: { id: string; html: string }[] };
        return { text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: `Mới ${s.html}` })) }) };
      },
    };
    const state = await runSample(project, ok);
    expect(state).toMatchObject({ status: 'done', failed: [], keptEdited: ['s3'] });
    await removeProject(project.id);
  });
});
