import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '../src/lib/app-services';
import { jobLockName } from '../src/lib/cross-tab-job-lock';
import { addProject } from '../src/lib/project-store';
import { providerConfig } from '../src/lib/provider-config-store';
import { getSampleJobState } from '../src/lib/sample-jobs';
import { getJobState, isJobActive } from '../src/lib/translation-jobs';
import {
  configureFakeProvider,
  eventually,
  type FakeProviderState,
  fakeFetch,
  holdLockElsewhere,
  makeProject,
  newProviderState,
  SENTINEL_KEY,
  type ToolHarness,
  toolHarness,
} from './webmcp-test-support';

let state: FakeProviderState;
let tools: ToolHarness;

beforeAll(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => fakeFetch(state)(input, init));
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  state = newProviderState();
  configureFakeProvider();
  tools?.unregister();
  tools = toolHarness({ fetch: (input, init) => fakeFetch(state)(input, init) });
});

async function addBook(id: string) {
  const project = makeProject(id);
  await addProject(project);
  return project;
}

describe('confirmation gating', () => {
  it('a declined start spends nothing and starts no job', async () => {
    const project = await addBook('declined-start');
    tools.confirmAnswers.push(false);
    const out = await tools.call('start_translation', { bookId: project.id });
    expect(out).toMatchObject({ ok: true, started: false, reason: 'declined', estimate: { usd: expect.any(Number) } });
    expect(tools.confirms).toHaveLength(1);
    expect(tools.confirms[0]).not.toContain(SENTINEL_KEY);
    expect(state.chatRequests).toBe(0);
    expect(getJobState(project.id).status).toBe('idle');
  });

  it('a declined delete keeps the book', async () => {
    const project = await addBook('declined-delete');
    tools.confirmAnswers.push(false);
    expect(await tools.call('delete_book', { bookId: project.id })).toMatchObject({ ok: true, deleted: false, reason: 'declined' });
    expect(await repository.exists(project.id)).toBe(true);
  });

  it('a declined import fetches nothing', async () => {
    tools.confirmAnswers.push(false);
    expect(await tools.call('import_book_from_url', { url: 'https://books.example.test/a.epub' })).toMatchObject({
      ok: true,
      imported: false,
      reason: 'declined',
    });
    expect(state.urlFetches).toHaveLength(0);
  });

  it('a provider that is not ready is reported before any dialog', async () => {
    const project = await addBook('not-ready');
    providerConfig.updateProfile('custom', { model: '' });
    expect(await tools.call('start_translation', { bookId: project.id })).toMatchObject({ ok: true, started: false, reason: 'provider-not-ready' });
    expect(await tools.call('translate_sample', { bookId: project.id })).toMatchObject({ ok: false, hint: expect.stringContaining('Settings') });
    expect(tools.confirms).toHaveLength(0);
    expect(state.chatRequests).toBe(0);
  });
});

describe('job locks', () => {
  it('paid tools and destructive tools refuse while another tab runs the book', async () => {
    const project = await addBook('busy-elsewhere');
    const release = await holdLockElsewhere(jobLockName(project.id));
    try {
      expect(await tools.call('start_translation', { bookId: project.id })).toMatchObject({ ok: true, started: false, reason: 'busy-elsewhere' });
      expect(await tools.call('translate_sample', { bookId: project.id })).toMatchObject({ ok: false, error: expect.stringContaining('another browser tab') });
      expect(await tools.call('generate_guide', { bookId: project.id })).toMatchObject({ ok: false, error: expect.stringContaining('another browser tab') });
      expect(await tools.call('retranslate_segment', { bookId: project.id, segmentId: 's1' })).toMatchObject({ ok: false });
      expect(await tools.call('delete_book', { bookId: project.id })).toMatchObject({ ok: false, error: expect.stringContaining('another browser tab') });
      expect(await tools.call('pause_translation', { bookId: project.id })).toMatchObject({ ok: false, hint: expect.stringContaining('that tab') });
      expect(await tools.call('get_book_status', { bookId: project.id })).toMatchObject({ ok: true, busyElsewhere: true });
      expect(tools.confirms).toHaveLength(0);
      expect(state.chatRequests).toBe(0);
      expect(await repository.exists(project.id)).toBe(true);
    } finally {
      await release();
    }
  });

  it('a running job here blocks samples, guide generation and retranslation, and pause_translation stops it', async () => {
    const project = await addBook('busy-here');
    let open: () => void = () => {};
    state.gate = new Promise((resolve) => {
      open = resolve;
    });
    expect(await tools.call('start_translation', { bookId: project.id })).toMatchObject({ ok: true, started: true });
    await eventually(() => state.chatRequests > 0);
    expect(isJobActive(project.id)).toBe(true);

    expect(await tools.call('start_translation', { bookId: project.id })).toMatchObject({ started: false, reason: 'already-running' });
    expect(await tools.call('translate_sample', { bookId: project.id })).toMatchObject({ ok: false, error: expect.stringContaining('translation run') });
    expect(await tools.call('generate_guide', { bookId: project.id })).toMatchObject({ ok: false, error: expect.stringContaining('translation run') });
    expect(await tools.call('retranslate_segment', { bookId: project.id, segmentId: 's1' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('translation run'),
    });
    expect(getSampleJobState(project.id).status).toBe('idle');

    expect(await tools.call('pause_translation', { bookId: project.id })).toMatchObject({ ok: true, paused: true, status: 'pausing' });
    open();
    await eventually(() => !isJobActive(project.id));
    // The fake provider ignores the abort, so the one in-flight batch may still complete the (tiny) book.
    expect(['paused', 'done']).toContain(getJobState(project.id).status);
  });
});
