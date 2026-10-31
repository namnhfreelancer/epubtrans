import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { type DomEnv, exportStylePreset, importBook, type Project } from '@epubtrans/core';
import { strFromU8, unzipSync } from 'fflate';
import { DOMParser } from 'linkedom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { styleTemplates } from '../src/lib/app-services';
import { addProject, ensureProject } from '../src/lib/project-store';
import { configureFakeProvider, type FakeProviderState, fakeFetch, makeProject, newProviderState, type ToolHarness, toolHarness } from './webmcp-test-support';

/** linkedom has no XMLSerializer; its nodes serialize themselves (XML syntax for XML documents). */
class LinkedomXMLSerializer {
  serializeToString(node: Node): string {
    return String(node);
  }
}
const env: DomEnv = {
  DOMParser: DOMParser as unknown as typeof globalThis.DOMParser,
  XMLSerializer: LinkedomXMLSerializer as unknown as typeof globalThis.XMLSerializer,
};

let state: FakeProviderState;
let tools: ToolHarness;

beforeAll(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => fakeFetch(state)(input, init));
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(async () => {
  state = newProviderState();
  configureFakeProvider();
  tools?.unregister();
  tools = toolHarness({ fetch: (input, init) => fakeFetch(state)(input, init), domEnv: env });
  for (const t of await styleTemplates.list()) await styleTemplates.remove(t.id);
});

/** The core fixture book, imported for real and translated by an echo, under a fresh id. */
async function addRealBook(id: string): Promise<Project> {
  const bytes = new Uint8Array(readFileSync(new URL('../../../packages/core/test/fixtures/a-modest-proposal.epub', import.meta.url)));
  const project = await importBook(bytes, 'a.epub', env);
  project.id = id;
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = `[vi] ${s.sourceHtml}`;
    s.status = 'translated';
  }
  await addProject(project);
  return project;
}

const filesOf = (data: Uint8Array) => unzipSync(data);

describe('export_epub style templates', () => {
  it('declares the optional template input', () => {
    const schema = tools.tools.get('export_epub')?.inputSchema as { properties: Record<string, { maxLength?: number }>; required: readonly string[] };
    expect(schema.properties.styleTemplate?.maxLength).toBe(80);
    expect(schema.required).not.toContain('styleTemplate');
  });

  it('rejects an unknown template and names the saved ones', async () => {
    const project = await addRealBook('style-unknown');
    expect(await tools.call('export_epub', { bookId: project.id, mode: 'bilingual', styleTemplate: 'Nope' })).toMatchObject({
      ok: false,
      hint: expect.stringContaining('no saved style templates'),
    });
    await styleTemplates.save('Learner teal', exportStylePreset('learner'));
    expect(await tools.call('export_epub', { bookId: project.id, mode: 'bilingual', styleTemplate: 'Nope' })).toMatchObject({
      ok: false,
      hint: expect.stringContaining('Learner teal'),
    });
    expect(tools.downloads).toHaveLength(0);
  });

  it('applies a saved template (fonts included) to this export only', async () => {
    const project = await addRealBook('style-template');
    await styleTemplates.save('Serif', { source: { italic: true }, translation: { font: 'literata', color: '#224466' } });
    const out = await tools.call('export_epub', { bookId: project.id, mode: 'bilingual', styleTemplate: 'serif' });
    expect(out).toMatchObject({ ok: true, style: { template: 'Serif' } });
    const files = filesOf(tools.downloads[0]?.data ?? new Uint8Array());
    const css = strFromU8(files['OEBPS/epubtrans.css'] ?? new Uint8Array());
    expect(css).toContain('color: #224466');
    expect(css).toContain('font-style: italic');
    expect(files['OEBPS/epubtrans-fonts/literata-regular.ttf']?.byteLength).toBe(95_372);
    // The book's own style is unchanged.
    expect((await ensureProject(project.id)).settings.exportStyle).toBeUndefined();

    // Without a template the book's style applies.
    expect(await tools.call('export_epub', { bookId: project.id, mode: 'bilingual' })).toMatchObject({ ok: true, style: { preset: 'classic' } });
    const plain = filesOf(tools.downloads[1]?.data ?? new Uint8Array());
    expect(Object.keys(plain).some((k) => k.includes('epubtrans-fonts'))).toBe(false);
  });
});

describe('update_book_settings stylePreset', () => {
  it('applies a preset over a preset look without asking, and reports it in get_book_status', async () => {
    const project = makeProject('style-preset');
    await addProject(project);
    expect(await tools.call('update_book_settings', { bookId: project.id, stylePreset: 'neon' })).toMatchObject({ ok: false });
    expect(await tools.call('update_book_settings', { bookId: project.id, stylePreset: 'learner' })).toMatchObject({ ok: true, stylePreset: 'learner' });
    expect(tools.confirms).toHaveLength(0);
    expect((await ensureProject(project.id)).settings.exportStyle).toEqual(exportStylePreset('learner'));
    expect(await tools.call('get_book_status', { bookId: project.id })).toMatchObject({ ok: true, exportStyle: { preset: 'learner', attribution: false } });
  });

  it('asks before replacing a custom style and keeps it when declined', async () => {
    const project = makeProject('style-custom');
    project.settings.exportStyle = { translation: { color: '#123456' } };
    await addProject(project);
    tools.confirmAnswers.push(false);
    expect(await tools.call('update_book_settings', { bookId: project.id, stylePreset: 'minimal' })).toMatchObject({
      ok: true,
      stylePreset: 'declined by the user',
    });
    expect(tools.confirms[0]).toContain('Minimal');
    expect((await ensureProject(project.id)).settings.exportStyle).toEqual({ translation: { color: '#123456' } });
    tools.confirmAnswers.push(true);
    expect(await tools.call('update_book_settings', { bookId: project.id, stylePreset: 'minimal' })).toMatchObject({ ok: true, stylePreset: 'minimal' });
    expect((await ensureProject(project.id)).settings.exportStyle).toEqual(exportStylePreset('minimal'));
  });
});
