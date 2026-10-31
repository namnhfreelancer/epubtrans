import 'fake-indexeddb/auto';
import { type ChatProvider, createDefaultSettings, type Project } from '@epubtrans/core';
import { afterEach, describe, expect, it } from 'vitest';
import { database } from '../src/lib/app-services';
import { jobLockName } from '../src/lib/cross-tab-job-lock';
import { addProject, removeProject } from '../src/lib/project-store';
import { getSampleJobState, startSampleJob } from '../src/lib/sample-jobs';
import { isJobActive, startJob } from '../src/lib/translation-jobs';

// Node implements the Web Locks API: a lock requested by the test itself stands in for another tab's job.

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
        segments: [1, 2].map((n) => ({ id: `s${n}`, sourceHtml: `Text ${n}`, sourceText: `Text ${n}`, status: 'pending' as const })),
      },
    ],
  };
}

const selection = { seed: 1, passages: [{ chapterHref: 'ch1.xhtml', chapterTitle: 'Chapter 1', segmentIds: ['s1'] }] };

/** A provider that holds every answer until `release()` is called. */
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
      await gate;
      return { text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: `Dịch ${s.html}` })) }) };
    },
  };
  return { provider, release, requests };
}

/** Holds the project's job lock like another tab running a job, until the returned release function is called. */
async function holdLockElsewhere(projectId: string): Promise<() => Promise<void>> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const done = navigator.locks.request(jobLockName(projectId), async () => {
    acquired();
    await held;
  });
  await ready;
  return async () => {
    release();
    await done;
  };
}

const lockHeld = async (projectId: string) => ((await navigator.locks.query()).held ?? []).some((l) => l.name === jobLockName(projectId));

describe('a sample run and the cross-tab job lock', () => {
  afterEach(async () => {
    await database.segments.clear();
  });

  it('does not start (and sends no request) while another tab holds the job lock', async () => {
    const project = makeProject('sample-busy-elsewhere');
    await addProject(project);
    const { provider, release, requests } = gatedProvider();
    release();
    const releaseLock = await holdLockElsewhere(project.id);

    expect(await startSampleJob(project, project.settings, provider, { selection })).toBe('busy-elsewhere');
    expect(requests).toHaveLength(0);
    expect(getSampleJobState(project.id).status).toBe('idle');
    // A refused start is forgotten at once: trying again is refused by the lock again, not as "already running".
    expect(await startSampleJob(project, project.settings, provider, { selection })).toBe('busy-elsewhere');

    await releaseLock();
    expect(await startSampleJob(project, project.settings, provider, { selection })).toBe('started');
    await expect.poll(() => getSampleJobState(project.id).status).toBe('done');
    expect(requests).toEqual([['s1']]);
    await removeProject(project.id);
  });

  it('holds the job lock while it runs, so another tab cannot start a job, and releases it afterwards', async () => {
    const project = makeProject('sample-holds-lock');
    await addProject(project);
    const { provider, release, requests } = gatedProvider();

    expect(await startSampleJob(project, project.settings, provider, { selection })).toBe('started');
    await expect.poll(() => requests.length).toBe(1);
    expect(await lockHeld(project.id)).toBe(true);
    // What another tab's Start would do: ask for the lock without waiting.
    const otherTab = await navigator.locks.request(jobLockName(project.id), { ifAvailable: true }, async (lock) => lock !== null);
    expect(otherTab).toBe(false);
    // A second sample in this tab is refused too.
    expect(await startSampleJob(project, project.settings, provider, { selection })).toBe('already-running');

    release();
    await expect.poll(() => getSampleJobState(project.id).status).toBe('done');
    await expect.poll(() => lockHeld(project.id)).toBe(false);
    await removeProject(project.id);
  });

  it('a full run is reported busy elsewhere while another tab holds the lock, and starts once it is free', async () => {
    const project = makeProject('job-busy-elsewhere');
    await addProject(project);
    const { provider, release, requests } = gatedProvider();
    release();
    const releaseLock = await holdLockElsewhere(project.id);

    expect(await startJob(project, project.settings, provider)).toBe('busy-elsewhere');
    expect(isJobActive(project.id)).toBe(false);
    expect(await startJob(project, project.settings, provider)).toBe('busy-elsewhere');
    expect(requests).toHaveLength(0);

    await releaseLock();
    expect(await startJob(project, project.settings, provider)).toBe('started');
    await expect.poll(() => isJobActive(project.id)).toBe(false);
    expect(requests.flat().sort()).toEqual(['s1', 's2']);
    await removeProject(project.id);
  });
});
