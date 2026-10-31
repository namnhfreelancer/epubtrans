import 'fake-indexeddb/auto';
import { type ChatProvider, createDefaultSettings, type Project, parseFrequencyList, planWordHints } from '@epubtrans/core';
import { afterEach, describe, expect, it } from 'vitest';
import { database, repository } from '../src/lib/app-services';
import { jobLockName } from '../src/lib/cross-tab-job-lock';
import { cancelHintJob, getHintJobState, isHintJobActive, startHintJob } from '../src/lib/hint-jobs';
import { addProject, removeProject } from '../src/lib/project-store';
import { startJob } from '../src/lib/translation-jobs';

// Node implements the Web Locks API, so the job lock behaves as in a browser tab.

const list = parseFrequencyList('en', `# test\n${Array.from({ length: 3000 }, (_, i) => `filler${i}`).join('\n')}\nperspicacious\ntruculent\n`);

function makeProject(id: string): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id,
    title: 'Book',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({
      sourceLang: 'en',
      targetLang: 'vi',
      concurrency: 1,
      model: 'm',
      wordHints: { enabled: true, level: 5, style: 'ruby', maxPerParagraph: 3, perChapter: 1 },
    }),
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [{ href: 'ch1.xhtml', title: 'Chapter 1', segments: [{ id: 's1', sourceHtml: 'perspicacious truculent', sourceText: '', status: 'pending' }] }],
  };
}

/** Answers gloss requests after `release()`; counts requests. */
function gatedGlossProvider() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const provider: ChatProvider = {
    listModels: async () => ['m'],
    chat: async (req) => {
      calls++;
      const { items } = JSON.parse(req.user) as { items: { id: string; lemma: string }[] };
      // Like a real adapter, an aborted request rejects right away.
      await Promise.race([
        gate,
        new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
      ]);
      return { text: JSON.stringify({ items: items.map((i) => ({ id: i.id, sense: 'main', gloss: `≈${i.lemma}` })) }) };
    },
  };
  return { provider, release, calls: () => calls };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe('a Word Wise hints job', () => {
  afterEach(async () => {
    await database.hints.clear();
  });

  it('holds the job lock, blocks a translation start in this tab, and persists every glossed word', async () => {
    const project = makeProject('hints-1');
    await addProject(project);
    const gated = gatedGlossProvider();
    expect(await startHintJob(project, planWordHints(project, list, project.settings), project.settings, gated.provider)).toBe('started');
    expect(isHintJobActive(project.id)).toBe(true);
    expect(((await navigator.locks.query()).held ?? []).some((l) => l.name === jobLockName(project.id))).toBe(true);
    expect(await startJob(project, (book) => book, gated.provider)).toBe('already-running');
    gated.release();
    await waitFor(() => getHintJobState(project.id).status === 'done');
    await waitFor(() => !isHintJobActive(project.id));
    const stored = await repository.loadProject(project.id);
    expect(stored.wordHints?.entries.map((e) => e.lemma).sort()).toEqual(['perspicacious', 'truculent']);
    // Everything is glossed: a new plan sends nothing.
    expect(planWordHints(stored, list, stored.settings).candidates).toEqual([]);
    await removeProject(project.id);
  });

  it('refuses to start while another tab holds the job lock, and a cancel keeps nothing half-written', async () => {
    const project = makeProject('hints-2');
    await addProject(project);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const other = navigator.locks.request(jobLockName(project.id), async () => {
      acquired();
      await held;
    });
    await ready;
    const gated = gatedGlossProvider();
    expect(await startHintJob(project, planWordHints(project, list, project.settings), project.settings, gated.provider)).toBe('busy-elsewhere');
    expect(gated.calls()).toBe(0);
    release();
    await other;

    expect(await startHintJob(project, planWordHints(project, list, project.settings), project.settings, gated.provider)).toBe('started');
    await waitFor(() => gated.calls() > 0);
    cancelHintJob(project.id);
    await waitFor(() => getHintJobState(project.id).status === 'cancelled');
    gated.release();
    expect((await repository.loadProject(project.id)).wordHints?.entries ?? []).toEqual([]);
    await removeProject(project.id);
  });
});
