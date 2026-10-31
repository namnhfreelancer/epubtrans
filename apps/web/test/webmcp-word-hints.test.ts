import 'fake-indexeddb/auto';
import { type ChatProvider, EXPORT_MODES, type Project, parseFrequencyList, planWordHints } from '@epubtrans/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '../src/lib/app-services';
import { exportFileName } from '../src/lib/download-file';
import { getHintJobState, isHintJobActive, startHintJob } from '../src/lib/hint-jobs';
import { addProject } from '../src/lib/project-store';
import {
  configureFakeProvider,
  eventually,
  type FakeProviderState,
  fakeFetch,
  makeProject,
  newProviderState,
  type ToolHarness,
  toolHarness,
} from './webmcp-test-support';

let state: FakeProviderState;
let tools: ToolHarness;

const list = parseFrequencyList('en', `# test\n${Array.from({ length: 3000 }, (_, i) => `filler${i}`).join('\n')}\nperspicacious\ntruculent\n`);

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

afterEach(() => {
  // Let any leftover hints run end so its job lock is free for the next test.
  state.gate = undefined;
});

/** A book with two rare words in English, Word Wise hints enabled at the most generous level. */
async function addHintBook(id: string): Promise<Project> {
  const project = makeProject(id, 1);
  project.settings = { ...project.settings, sourceLang: 'en', wordHints: { enabled: true, level: 5, style: 'ruby', maxPerParagraph: 3, perChapter: 1 } };
  const [segment] = project.chapters[0]?.segments ?? [];
  if (segment) segment.sourceHtml = 'perspicacious truculent';
  await addProject(project);
  return project;
}

/** Answers gloss requests only after `release()`; counts the requests that reached it. */
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
      await Promise.race([
        gate,
        new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
      ]);
      return { text: JSON.stringify({ items: items.map((i) => ({ id: i.id, sense: 'main', gloss: `≈${i.lemma}` })) }) };
    },
  };
  return { provider, release, calls: () => calls };
}

async function startHints(project: Project, provider: ChatProvider) {
  const plan = planWordHints(project, list, project.settings);
  expect(await startHintJob(project, plan, project.settings, provider)).toBe('started');
}

describe('WebMCP tools and Word Wise hints', () => {
  it('export_epub offers every core export mode, the new original mode included, plus the hint options', () => {
    const schema = tools.tools.get('export_epub')?.inputSchema as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties.mode?.enum).toEqual([...EXPORT_MODES]);
    expect(schema.properties.mode?.enum).toContain('original');
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['hintStyle', 'maxHintsPerParagraph', 'hintsPerChapter']));
  });

  it('export_epub rejects invalid hint options before building anything', async () => {
    const project = await addHintBook('wh-export-validate');
    expect(await tools.call('export_epub', { bookId: project.id, mode: 'original', hintStyle: 'blink' })).toMatchObject({ ok: false });
    expect(await tools.call('export_epub', { bookId: project.id, mode: 'original', maxHintsPerParagraph: -1 })).toMatchObject({ ok: false });
    expect(tools.downloads).toEqual([]);
  });

  it('names the original export like the Export tab does, after the source language', async () => {
    const project = await addHintBook('wh-file-name');
    expect(exportFileName(project, 'original')).toBe('Book wh-file-name.en.original.epub');
    expect(exportFileName(project, 'translation-only')).toBe('Book wh-file-name.vi.translated.epub');
    expect(exportFileName({ ...project, settings: { ...project.settings, sourceLang: 'auto' } }, 'original')).toBe('Book wh-file-name.source.original.epub');
  });

  it('get_book_status reports the hints state', async () => {
    const project = await addHintBook('wh-status');
    expect(await tools.call('get_book_status', { bookId: project.id })).toMatchObject({
      ok: true,
      wordHints: { enabled: true, level: 5, glossedWords: 0, job: 'idle' },
    });
  });

  it('refuses paid work while hints are being generated, without spending anything', async () => {
    const project = await addHintBook('wh-busy');
    const gated = gatedGlossProvider();
    await startHints(project, gated.provider);
    expect(await tools.call('start_translation', { bookId: project.id })).toMatchObject({ ok: true, started: false, reason: 'hints-running' });
    expect(await tools.call('translate_sample', { bookId: project.id, passages: 1 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Word Wise hints'),
    });
    expect(await tools.call('generate_guide', { bookId: project.id, maxEntries: 30 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Word Wise hints'),
    });
    expect(await tools.call('retranslate_segment', { bookId: project.id, segmentId: 's1' })).toMatchObject({ ok: false });
    expect(state.chatRequests).toBe(0);
    expect(tools.confirms).toEqual([]);
    gated.release();
    await eventually(() => !isHintJobActive(project.id));
  });

  it('delete_book stops a running hints job: no request or write follows the deletion', async () => {
    const project = await addHintBook('wh-delete');
    const gated = gatedGlossProvider();
    await startHints(project, gated.provider);
    await eventually(() => gated.calls() > 0);
    expect(await tools.call('delete_book', { bookId: project.id })).toMatchObject({ ok: true, deleted: true });
    expect(isHintJobActive(project.id)).toBe(false);
    expect(getHintJobState(project.id).status).toBe('cancelled');
    const callsAtDelete = gated.calls();
    gated.release();
    await new Promise((r) => setTimeout(r, 50));
    expect(gated.calls()).toBe(callsAtDelete);
    expect(await repository.exists(project.id)).toBe(false);
  });
});
