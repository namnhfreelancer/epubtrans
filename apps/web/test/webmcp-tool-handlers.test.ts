import 'fake-indexeddb/auto';
import { saveProjectFile } from '@epubtrans/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeys } from '../src/lib/api-key-store';
import { repository } from '../src/lib/app-services';
import { getGuideJobState } from '../src/lib/guide-jobs';
import { addProject, ensureProject } from '../src/lib/project-store';
import { providerConfig } from '../src/lib/provider-config-store';
import { getJobState } from '../src/lib/translation-jobs';
import {
  configureFakeProvider,
  eventually,
  type FakeProviderState,
  fakeFetch,
  makeProject,
  newProviderState,
  SENTINEL_KEY,
  type ToolHarness,
  toolHarness,
} from './webmcp-test-support';

let state: FakeProviderState;
let tools: ToolHarness;
/** Every output of every harness in this file, for the final key-leak assertion. */
const allOutputs: string[] = [];

beforeAll(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => fakeFetch(state)(input, init));
});

afterAll(() => {
  vi.unstubAllGlobals();
  // The planted key never reached an agent, whatever the tool, input or failure.
  expect(allOutputs.length).toBeGreaterThan(30);
  for (const out of allOutputs) expect(out).not.toContain(SENTINEL_KEY);
});

beforeEach(() => {
  state = newProviderState();
  configureFakeProvider();
  tools?.unregister();
  tools = toolHarness({ fetch: (input, init) => fakeFetch(state)(input, init) });
});

afterEach(() => {
  allOutputs.push(...tools.outputs);
});

async function addBook(id: string, segments = 3) {
  const project = makeProject(id, segments);
  await addProject(project);
  return project;
}

describe('read tools', () => {
  it('list_books lists books with counts and job status', async () => {
    await addBook('list-1');
    const out = await tools.call('list_books');
    expect(out.ok).toBe(true);
    const books = out.books as { id: string; title: string; total: number; job: string }[];
    expect(books.find((b) => b.id === 'list-1')).toMatchObject({ title: 'Book list-1', total: 3, job: 'idle' });
  });

  it('get_book_status reports settings, counts, provider readiness and the estimate', async () => {
    await addBook('status-1');
    const out = await tools.call('get_book_status', { bookId: 'status-1' });
    expect(out).toMatchObject({
      ok: true,
      targetLang: 'vi',
      remaining: 3,
      counts: { total: 3, pending: 3 },
      job: { status: 'idle' },
      provider: { providerId: 'custom', model: 'mock-model', ready: true },
    });
    const estimate = out.estimate as { inputTokens: number; usd: number | null };
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.usd).not.toBeNull();
  });

  it('get_book_status explains unknown ids and bad input without throwing', async () => {
    expect(await tools.call('get_book_status', { bookId: 'nope' })).toMatchObject({ ok: false, hint: expect.stringContaining('list_books') });
    expect(await tools.call('get_book_status', {})).toMatchObject({ ok: false, error: '"bookId" is required.' });
    expect(await tools.call('get_book_status', { bookId: 7 })).toMatchObject({ ok: false, error: '"bookId" must be a string.' });
    expect(await tools.call('list_books', { extra: true })).toMatchObject({ ok: false, error: expect.stringContaining('Unknown property') });
  });
});

describe('settings and provider tools', () => {
  it('update_book_settings validates and applies languages, two-pass and presets', async () => {
    const project = await addBook('settings-1');
    expect(await tools.call('update_book_settings', { bookId: project.id })).toMatchObject({ ok: false, error: 'Nothing to change.' });
    expect(await tools.call('update_book_settings', { bookId: project.id, targetLang: 'not a tag' })).toMatchObject({ ok: false });
    const out = await tools.call('update_book_settings', {
      bookId: project.id,
      targetLang: 'FR',
      sourceLang: 'auto',
      twoPass: true,
      guidelinePreset: 'fiction',
    });
    expect(out).toMatchObject({ ok: true, targetLang: 'fr', sourceLang: 'auto', twoPass: true, guidelinePreset: 'fiction' });
    expect(tools.navigations.at(-1)).toEqual({ name: 'book', id: project.id, tab: 'setup' });
    // The default guideline was a preset: no confirmation was needed.
    expect(tools.confirms).toHaveLength(0);
  });

  it('update_book_settings asks before replacing custom guideline text, and keeps it when declined', async () => {
    const project = await addBook('settings-2');
    const live = await ensureProject(project.id);
    live.settings = { ...live.settings, guideline: 'My own careful notes.' };
    tools.confirmAnswers.push(false);
    const out = await tools.call('update_book_settings', { bookId: project.id, guidelinePreset: 'technical' });
    expect(out).toMatchObject({ ok: true, guidelinePreset: 'declined by the user' });
    expect(tools.confirms[0]).toContain('An AI agent asks');
    expect(live.settings.guideline).toBe('My own careful notes.');
  });

  it('configure_provider switches preset and model and only reports whether a key exists', async () => {
    apiKeys.setKey('openai', SENTINEL_KEY, false);
    const out = await tools.call('configure_provider', { providerId: 'openai', model: 'gpt-x' });
    expect(out).toMatchObject({ ok: true, providerId: 'openai', model: 'gpt-x', keyPresent: true, ready: true });
    expect(providerConfig.store.get().providerId).toBe('openai');
    apiKeys.clearKey('anthropic');
    expect(await tools.call('configure_provider', { providerId: 'anthropic' })).toMatchObject({ keyPresent: false, ready: false, problem: expect.any(String) });
    expect(await tools.call('configure_provider', { providerId: 'evil' })).toMatchObject({ ok: false });
    expect(await tools.call('configure_provider', { providerId: 'custom', baseURL: 'https://attacker.test' })).toMatchObject({ ok: false });
    expect(providerConfig.store.get().profiles.custom?.baseURL).toBe('https://mock-provider.test/v1');
  });

  it('list_models lists and filters provider models', async () => {
    expect(await tools.call('list_models')).toMatchObject({ ok: true, total: 3, models: ['mock-model', 'mock-model-pro', 'other-model'] });
    expect(await tools.call('list_models', { filter: 'PRO' })).toMatchObject({ ok: true, total: 1, models: ['mock-model-pro'] });
  });

  it('list_models never passes on a key echoed by a provider error', async () => {
    state.echoKeyOnModels = true;
    const out = await tools.call('list_models');
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('[redacted]') });
  });
});

describe('paid tools', () => {
  it('generate_guide drafts and saves the guideline and glossary, shown in the guide store', async () => {
    const project = await addBook('guide-1');
    const out = await tools.call('generate_guide', { bookId: project.id, maxEntries: 30 });
    expect(out).toMatchObject({ ok: true, glossaryEntries: 1, sample: ['Gulliver → Gu-li-vơ'] });
    expect(getGuideJobState(project.id)).toMatchObject({ kind: 'done', entries: 1 });
    expect((await ensureProject(project.id)).settings.glossary).toHaveLength(1);
    expect(await tools.call('generate_guide', { bookId: project.id, maxEntries: 5 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('between 30'),
    });
  });

  it('translate_sample waits for the sample and returns usage and a plain-text preview', async () => {
    const project = await addBook('sample-1', 4);
    const out = await tools.call('translate_sample', { bookId: project.id, passages: 1 });
    expect(out).toMatchObject({ ok: true, usage: { input: expect.any(Number) } });
    const preview = out.preview as { source: string; translation: string }[];
    expect(preview.length).toBeGreaterThan(0);
    expect(preview[0]?.source).toMatch(/^Text number \d about Gulliver & his travels\.$/);
    expect(preview[0]?.translation).toMatch(/^Dịch Text number/);
  });

  it('translate_sample keeps hand-edited segments and reports failed and kept counts', async () => {
    const project = await addBook('sample-2', 4);
    const edited = project.chapters[0]?.segments[0];
    if (!edited) throw new Error('fixture has no segments');
    edited.translationHtml = 'Bản tự sửa';
    edited.status = 'translated';
    edited.userEdited = true;
    state.invalidIds.add('s2');
    const out = await tools.call('translate_sample', { bookId: project.id, passages: 4 });
    expect(out).toMatchObject({ ok: true, keptEdited: 1, failed: 1, failedIds: ['s2'] });
    expect(edited.translationHtml).toBe('Bản tự sửa');
  });

  it('start_translation shows provider, model and cost, then starts; list_errors and retranslate_segment fix failures', async () => {
    const project = await addBook('run-1', 3);
    state.invalidIds.add('s2');
    const out = await tools.call('start_translation', { bookId: project.id });
    expect(out).toMatchObject({ ok: true, started: true, remaining: 3 });
    expect(tools.confirms[0]).toMatch(/Custom.*mock-model.*3 segments.*\$/s);
    await eventually(() => getJobState(project.id).status === 'done' || getJobState(project.id).status === 'failed');

    const errors = await tools.call('list_errors', { bookId: project.id });
    expect(errors).toMatchObject({ ok: true, total: 1, items: [{ segmentId: 's2', chapter: 1, chapterTitle: 'Chapter 1' }] });

    state.invalidIds.clear();
    const fixed = await tools.call('retranslate_segment', { bookId: project.id, segmentId: 's2' });
    expect(fixed).toMatchObject({ ok: true, segmentId: 's2', status: 'translated', translation: expect.stringContaining('Dịch Text number 2') });
    expect(tools.navigations.at(-1)).toEqual({ name: 'book', id: project.id, tab: 'read', segment: 's2' });
    expect(await tools.call('retranslate_segment', { bookId: project.id, segmentId: 'zzz' })).toMatchObject({ ok: false });
    expect(await tools.call('list_errors', { bookId: project.id })).toMatchObject({ ok: true, total: 0, items: [] });
    expect(await tools.call('start_translation', { bookId: project.id })).toMatchObject({ ok: true, started: false, reason: 'nothing-to-translate' });
  });

  it('pause_translation reports when nothing runs', async () => {
    const project = await addBook('pause-1');
    expect(await tools.call('pause_translation', { bookId: project.id })).toMatchObject({ ok: true, paused: false, status: 'idle' });
  });
});

describe('library tools', () => {
  it('import_book_from_url downloads an approved https file into the library', async () => {
    const source = makeProject('imported-1');
    const bytes = await saveProjectFile(source);
    const url = 'https://books.example.test/shelf/imported.epubtrans';
    state.urls.set(url, () => new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-length': String(bytes.byteLength) } }));
    const out = await tools.call('import_book_from_url', { url });
    expect(out).toMatchObject({ ok: true, bookId: 'imported-1', segments: 3 });
    expect(tools.confirms[0]).toContain('books.example.test');
    expect(await repository.exists('imported-1')).toBe(true);
    expect(tools.navigations.at(-1)).toEqual({ name: 'book', id: 'imported-1', tab: 'setup' });
    // The same project file again is refused (only the user may replace a book).
    expect(await tools.call('import_book_from_url', { url })).toMatchObject({ ok: false, error: expect.stringContaining('already') });
  });

  it('import_book_from_url refuses http, credentials and oversized files, and explains CORS failures', async () => {
    expect(await tools.call('import_book_from_url', { url: 'http://localhost:8080/admin' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('https'),
    });
    expect(await tools.call('import_book_from_url', { url: 'https://u:p@host.test/b.epub' })).toMatchObject({ ok: false });
    expect(await tools.call('import_book_from_url', { url: 'not a url' })).toMatchObject({ ok: false });
    expect(tools.confirms).toHaveLength(0);

    const cors = await tools.call('import_book_from_url', { url: 'https://no-cors.example.test/book.epub' });
    expect(cors).toMatchObject({ ok: false, error: expect.stringContaining('CORS'), hint: expect.stringContaining('drop') });

    state.urls.set('https://big.example.test/book.epub', () => new Response('x', { headers: { 'content-length': String(400 * 1024 * 1024) } }));
    expect(await tools.call('import_book_from_url', { url: 'https://big.example.test/book.epub' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('larger'),
    });

    state.urls.set('https://gone.example.test/book.epub', () => new Response('nope', { status: 404 }));
    expect(await tools.call('import_book_from_url', { url: 'https://gone.example.test/book.epub' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('404'),
    });
  });

  it('export_epub validates the mode against core', async () => {
    const project = await addBook('export-1');
    expect(await tools.call('export_epub', { bookId: project.id, mode: 'pdf' })).toMatchObject({ ok: false, error: expect.stringContaining('bilingual') });
    expect(await tools.call('export_epub', { bookId: 'missing', mode: 'bilingual' })).toMatchObject({ ok: false });
  });

  it('delete_book removes the book after the user confirms', async () => {
    const project = await addBook('delete-ok');
    expect(await tools.call('delete_book', { bookId: project.id })).toMatchObject({ ok: true, deleted: true });
    expect(tools.confirms[0]).toContain('Delete “Book delete-ok”');
    expect(await repository.exists(project.id)).toBe(false);
  });
});

describe('key isolation', () => {
  it('no tool emits the planted key even without the redaction layer', async () => {
    const bare = toolHarness({ fetch: (input, init) => fakeFetch(state)(input, init), secrets: () => [] });
    const project = await addBook('leak-1');
    await bare.call('list_books');
    await bare.call('get_book_status', { bookId: project.id });
    await bare.call('configure_provider', { providerId: 'custom', model: 'mock-model' });
    await bare.call('list_models');
    await bare.call('generate_guide', { bookId: project.id, maxEntries: 30 });
    await bare.call('translate_sample', { bookId: project.id, passages: 1 });
    bare.confirmAnswers.push(false);
    await bare.call('start_translation', { bookId: project.id });
    await bare.call('list_errors', { bookId: project.id });
    await bare.call('retranslate_segment', { bookId: project.id, segmentId: 's1' });
    await bare.call('update_book_settings', { bookId: project.id, twoPass: false });
    for (const out of bare.outputs) expect(out).not.toContain(SENTINEL_KEY);
    allOutputs.push(...bare.outputs);
    bare.unregister();
  });
});
