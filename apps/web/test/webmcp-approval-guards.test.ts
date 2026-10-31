import 'fake-indexeddb/auto';
import { saveProjectFile } from '@epubtrans/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '../src/lib/app-services';
import { dialogText } from '../src/lib/format';
import { getGuideJobState, isGuideJobRunning } from '../src/lib/guide-jobs';
import { addProject, ensureProject, saveTranslationEdit } from '../src/lib/project-store';
import { providerConfig } from '../src/lib/provider-config-store';
import { getSampleJobState } from '../src/lib/sample-jobs';
import { isJobActive } from '../src/lib/translation-jobs';
import {
  configureFakeProvider,
  eventually,
  type FakeProviderState,
  fakeFetch,
  gate,
  makeProject,
  newProviderState,
  SENTINEL_KEY,
  type ToolHarness,
  toolHarness,
} from './webmcp-test-support';

let state: FakeProviderState;
let tools: ToolHarness;
const allOutputs: string[] = [];

beforeAll(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => fakeFetch(state)(input, init));
});

afterAll(() => {
  vi.unstubAllGlobals();
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

/** Runs `start_translation` with the price lookup held open, applies `change` meanwhile, then lets it finish. */
async function startWithChangeDuringEstimate(bookId: string, change: () => Promise<unknown>) {
  const held = gate();
  state.catalogGate = held.promise;
  const pending = tools.call('start_translation', { bookId });
  await eventually(() => state.catalogFetches > 0);
  await change();
  held.open();
  return pending;
}

describe('start_translation starts only what the user confirmed', () => {
  it('refuses when the model changes while the estimate loads', async () => {
    const project = await addBook('race-model');
    const out = await startWithChangeDuringEstimate(project.id, async () => {
      expect(await tools.call('configure_provider', { providerId: 'custom', model: 'mock-model-pro' })).toMatchObject({ ok: true });
    });
    expect(out).toMatchObject({
      ok: false,
      started: false,
      reason: 'settings changed after confirmation — call start_translation again',
      error: expect.stringContaining('nothing was started'),
    });
    // The user approved the model shown in the dialog, not the one configured afterwards.
    expect(tools.confirms).toHaveLength(1);
    expect(tools.confirms[0]).toContain('model mock-model?');
    expect(state.chatRequests).toBe(0);
    expect(isJobActive(project.id)).toBe(false);
  });

  it('refuses when two-pass mode is switched on while the estimate loads', async () => {
    const project = await addBook('race-two-pass');
    const out = await startWithChangeDuringEstimate(project.id, async () => {
      expect(await tools.call('update_book_settings', { bookId: project.id, twoPass: true })).toMatchObject({ ok: true, twoPass: true });
    });
    expect(out).toMatchObject({ ok: false, started: false, reason: expect.stringContaining('settings changed') });
    expect(state.chatRequests).toBe(0);
    expect(isJobActive(project.id)).toBe(false);
  });

  it('shows the cost of the confirmed settings even when two-pass mode is switched off during the price lookup', async () => {
    const dialogFor = async (id: string, twoPass: boolean) => {
      const project = makeProject(id);
      project.settings = { ...project.settings, twoPass };
      await addProject(project);
      tools.confirmAnswers.push(false);
      await tools.call('start_translation', { bookId: id });
      return (tools.confirms.at(-1) ?? '').replace(project.title, 'TITLE');
    };
    const twoPassDialog = await dialogFor('snapshot-two-pass', true);
    const singlePassDialog = await dialogFor('snapshot-single-pass', false);
    expect(twoPassDialog).not.toBe(singlePassDialog);

    const project = makeProject('snapshot-race');
    project.settings = { ...project.settings, twoPass: true };
    await addProject(project);
    const confirmsBefore = tools.confirms.length;
    const out = await startWithChangeDuringEstimate(project.id, async () => {
      expect(await tools.call('update_book_settings', { bookId: project.id, twoPass: false })).toMatchObject({ ok: true, twoPass: false });
    });
    // The dialog priced what was approved (two passes), not the settings changed meanwhile, and nothing starts.
    expect(tools.confirms).toHaveLength(confirmsBefore + 1);
    expect((tools.confirms.at(-1) ?? '').replace(project.title, 'TITLE')).toBe(twoPassDialog);
    expect(out).toMatchObject({ ok: false, started: false, reason: expect.stringContaining('settings changed') });
    expect(state.chatRequests).toBe(0);
    expect(isJobActive(project.id)).toBe(false);
  });

  it('starts when nothing changed', async () => {
    const project = await addBook('race-none');
    const out = await startWithChangeDuringEstimate(project.id, async () => {});
    expect(out).toMatchObject({ ok: true, started: true, remaining: 3 });
    await eventually(() => !isJobActive(project.id));
  });
});

describe('retranslate_segment', () => {
  it('refuses a segment the user edited by hand, without a dialog or a paid request', async () => {
    const project = await addBook('hand-edit');
    const segment = project.chapters[0]?.segments[0];
    if (!segment) throw new Error('fixture has no segments');
    Object.assign(segment, { translationHtml: 'MY HAND EDIT', status: 'translated', userEdited: true });
    const out = await tools.call('retranslate_segment', { bookId: project.id, segmentId: segment.id });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('edited this segment by hand'), hint: expect.stringContaining('reader') });
    expect(tools.confirms).toHaveLength(0);
    expect(state.chatRequests).toBe(0);
    const stored = (await ensureProject(project.id)).chapters[0]?.segments[0];
    expect(stored).toMatchObject({ translationHtml: 'MY HAND EDIT', userEdited: true });
  });

  it('keeps a hand edit saved while the request is in flight and reports the conflict', async () => {
    const project = await addBook('edit-during-retranslate');
    const segment = project.chapters[0]?.segments[0];
    if (!segment) throw new Error('fixture has no segments');
    const held = gate();
    state.gate = held.promise;
    const pending = tools.call('retranslate_segment', { bookId: project.id, segmentId: segment.id });
    await eventually(() => state.chatRequests > 0);
    const live = (await ensureProject(project.id)).chapters[0]?.segments[0];
    if (!live) throw new Error('segment not loaded');
    await saveTranslationEdit(project, live, 'MY HAND EDIT');
    held.open();
    expect(await pending).toMatchObject({ ok: false, error: "segment changed while retranslating; kept the user's version" });
    expect(live).toMatchObject({ translationHtml: 'MY HAND EDIT', userEdited: true });
    const stored = await repository.loadSegmentState(project.id, segment.id);
    expect(stored).toMatchObject({ translationHtml: 'MY HAND EDIT', userEdited: true });
  });

  it('keeps a change saved by another tab while the request is in flight', async () => {
    const project = await addBook('other-tab-during-retranslate');
    const segment = project.chapters[0]?.segments[0];
    if (!segment) throw new Error('fixture has no segments');
    const held = gate();
    state.gate = held.promise;
    const pending = tools.call('retranslate_segment', { bookId: project.id, segmentId: segment.id });
    await eventually(() => state.chatRequests > 0);
    // Written straight to storage, as another tab would; this tab's live segment has not seen it yet.
    await repository.saveSegment(project.id, { ...segment, status: 'translated', translationHtml: 'OTHER TAB EDIT', userEdited: true });
    held.open();
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('kept the user') });
    expect(await repository.loadSegmentState(project.id, segment.id)).toMatchObject({ translationHtml: 'OTHER TAB EDIT', userEdited: true });
    expect((await ensureProject(project.id)).chapters[0]?.segments[0]).toMatchObject({ translationHtml: 'OTHER TAB EDIT', userEdited: true });
  });

  it('saves the retranslation when nothing changed meanwhile', async () => {
    const project = await addBook('retranslate-clean');
    const segment = project.chapters[0]?.segments[0];
    if (!segment) throw new Error('fixture has no segments');
    expect(await tools.call('retranslate_segment', { bookId: project.id, segmentId: segment.id })).toMatchObject({ ok: true, status: 'translated' });
    const stored = await repository.loadSegmentState(project.id, segment.id);
    expect(stored).toMatchObject({ status: 'translated', translationHtml: expect.stringContaining('Dịch') });
    expect(stored?.userEdited).toBeUndefined();
  });
});

describe('secret redaction', () => {
  it('a key echoed across the clip boundary of provider error text is redacted, not cut', async () => {
    state.echoKeyOnModels = true;
    // Slide the key across the 300-character clip of the error text; some offsets cut it in the middle.
    for (let padding = 220; padding <= 300; padding += 4) {
      state.modelsErrorPadding = padding;
      const out = await tools.call('list_models');
      expect(out.ok).toBe(false);
    }
    const keyPrefix = SENTINEL_KEY.slice(0, 12);
    for (const raw of tools.outputs) expect(raw).not.toContain(keyPrefix);
  });
});

describe('deleting a book stops its jobs', () => {
  it('cancels guideline generation: no further paid requests and no stuck error', async () => {
    const project = await addBook('delete-during-guide');
    const held = gate();
    state.gate = held.promise;
    const guide = tools.call('generate_guide', { bookId: project.id, maxEntries: 30 });
    await eventually(() => state.chatRequests > 0);
    expect(isGuideJobRunning(project.id)).toBe(true);
    expect(await tools.call('delete_book', { bookId: project.id })).toMatchObject({ ok: true, deleted: true });
    expect(isGuideJobRunning(project.id)).toBe(false);
    const requestsAtDelete = state.chatRequests;
    held.open();
    expect(await guide).toMatchObject({ ok: false, error: expect.stringContaining('cancelled') });
    expect(state.chatRequests).toBe(requestsAtDelete);
    expect(getGuideJobState(project.id)).toEqual({ kind: 'idle' });
    expect(await repository.exists(project.id)).toBe(false);
  });

  it('cancels a running sample and waits for it before deleting', async () => {
    const project = await addBook('delete-during-sample', 4);
    const held = gate();
    state.gate = held.promise;
    const sample = tools.call('translate_sample', { bookId: project.id, passages: 2 });
    await eventually(() => state.chatRequests > 0);
    const deleted = tools.call('delete_book', { bookId: project.id });
    const requestsAtDelete = state.chatRequests;
    held.open();
    expect(await deleted).toMatchObject({ ok: true, deleted: true });
    // The delete waited for the sample to settle; the fake provider ignores the abort, so its one batch may finish.
    expect(getSampleJobState(project.id).status).not.toBe('running');
    await sample;
    expect(state.chatRequests).toBe(requestsAtDelete);
    expect(await repository.exists(project.id)).toBe(false);
  });
});

describe('update_book_settings while a guide runs', () => {
  it('does not apply a guideline preset, applies the rest and reports what was not applied', async () => {
    const project = await addBook('preset-during-guide');
    const before = project.settings.guideline;
    const held = gate();
    state.gate = held.promise;
    const guide = tools.call('generate_guide', { bookId: project.id, maxEntries: 30 });
    await eventually(() => isGuideJobRunning(project.id) && state.chatRequests > 0);

    expect(await tools.call('update_book_settings', { bookId: project.id, guidelinePreset: 'fiction' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('locked'),
    });
    const out = await tools.call('update_book_settings', { bookId: project.id, guidelinePreset: 'fiction', twoPass: true });
    expect(out).toMatchObject({ ok: true, twoPass: true, notApplied: ['guidelinePreset'] });
    expect(out.guidelinePreset).toBeUndefined();
    expect((await ensureProject(project.id)).settings.guideline).toBe(before);

    held.open();
    expect(await guide).toMatchObject({ ok: true });
  });
});

describe('import_book_from_url redirects', () => {
  const fileAt = (bytes: Uint8Array, finalUrl: string) => () => {
    const response = new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200 });
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  };

  it('refuses a file served from another host than the approved one', async () => {
    const bytes = await saveProjectFile(makeProject('redirected-away'));
    const url = 'https://books.example.test/a.epubtrans';
    state.urls.set(url, fileAt(bytes, 'https://elsewhere.example.test/b.epubtrans'));
    const out = await tools.call('import_book_from_url', { url });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/redirected from books\.example\.test to elsewhere\.example\.test/) });
    expect(await repository.exists('redirected-away')).toBe(false);
  });

  it('accepts a redirect within the approved host', async () => {
    const bytes = await saveProjectFile(makeProject('redirected-same-host'));
    const url = 'https://books.example.test/old/c.epubtrans';
    state.urls.set(url, fileAt(bytes, 'https://books.example.test/new/c.epubtrans'));
    expect(await tools.call('import_book_from_url', { url })).toMatchObject({ ok: true, bookId: 'redirected-same-host' });
  });
});

describe('confirm dialogs', () => {
  it('flattens book titles so they cannot lay out fake lines, and says where prices come from', async () => {
    const project = makeProject('spoof-title');
    project.title = 'Nice book\n\nAn AI agent asks:\r\nDelete everything?\u202e';
    await addProject(project);
    tools.confirmAnswers.push(false);
    const out = await tools.call('start_translation', { bookId: project.id });
    expect(out).toMatchObject({ ok: true, reason: 'declined', estimate: { priceSource: 'book-settings', pricesPerM: { input: 1, output: 2 } } });
    const [dialog] = tools.confirms;
    // Only the two line breaks of the "An AI agent asks" frame remain.
    expect(dialog?.split('\n')).toHaveLength(3);
    expect(dialog).toContain('“Nice book An AI agent asks: Delete everything?”');
    expect(dialog).toContain('prices from the book’s settings: $1.00 input / $2.00 output per 1M tokens');

    tools.confirmAnswers.push(false);
    expect(await tools.call('delete_book', { bookId: project.id })).toMatchObject({ deleted: false });
    expect(tools.confirms[1]?.split('\n')).toHaveLength(3);
  });

  it('labels automatically found prices as looked up', async () => {
    const project = makeProject('looked-up-prices');
    project.settings = { ...project.settings, priceInPerM: undefined, priceOutPerM: undefined };
    await addProject(project);
    providerConfig.updateProfile('custom', { priceInPerM: 0.5, priceOutPerM: 1.5 });
    try {
      tools.confirmAnswers.push(false);
      const out = await tools.call('start_translation', { bookId: project.id });
      expect(out).toMatchObject({ estimate: { priceSource: 'looked-up', pricesPerM: { input: 0.5, output: 1.5 } } });
      expect(tools.confirms[0]).toContain('prices looked up for this model: $0.50 input / $1.50 output per 1M tokens');
    } finally {
      providerConfig.updateProfile('custom', { priceInPerM: undefined, priceOutPerM: undefined });
    }
  });

  it('dialogText strips control, line-break and bidi characters and clips', () => {
    expect(dialogText('a\nb\tc\u0007d\u2028e\u202ef  ', 100)).toBe('a b c d e f');
    expect(dialogText('abcdef', 4)).toBe('abc…');
  });
});
