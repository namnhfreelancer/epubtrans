import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '../src/lib/app-services';
import { jobLockName } from '../src/lib/cross-tab-job-lock';
import { buildErrorIndex, isWarnedSegment } from '../src/lib/error-index';
import { addProject, saveTranslationEdit, targetChangeNeedsDecision, updateSettingsAndResetTranslations } from '../src/lib/project-store';
import { parseProviderConfig, providerConfig, resolveActiveProvider, settingsForRun } from '../src/lib/provider-config-store';
import { applyStoredState, isSegmentStateRow } from '../src/lib/segment-revision';
import { withTextExtension } from '../src/webmcp/fetch-book-from-url';
import {
  configureFakeProvider,
  type FakeProviderState,
  fakeFetch,
  holdLockElsewhere,
  makeProject,
  newProviderState,
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

/** A stored book whose first segment is translated (with a warning) and whose second failed. */
async function translatedBook(id: string) {
  const project = makeProject(id, 3);
  const [first, second] = project.chapters[0]?.segments ?? [];
  if (!first || !second) throw new Error('fixture changed');
  Object.assign(first, { status: 'translated', translationHtml: first.sourceHtml, warning: 'identical', userEdited: true });
  Object.assign(second, { status: 'error', error: 'boom' });
  await addProject(project);
  return project;
}

describe('target language guard', () => {
  it('asks only when translations exist and the language really changes', async () => {
    const project = await translatedBook('guard-1');
    expect(targetChangeNeedsDecision(project, 'VI')).toBe(false);
    expect(targetChangeNeedsDecision(project, 'fr')).toBe(true);
    expect(targetChangeNeedsDecision(makeProject('fresh', 2), 'fr')).toBe(false);
  });

  it('resets every segment in memory and in storage together with the new language', async () => {
    const project = await translatedBook('guard-2');
    expect(await updateSettingsAndResetTranslations(project, { targetLang: 'fr' })).toBe('done');
    expect(project.settings.targetLang).toBe('fr');
    for (const s of project.chapters[0]?.segments ?? []) {
      expect(s.status).toBe('pending');
      expect(s).not.toHaveProperty('translationHtml');
      expect(s).not.toHaveProperty('error');
      expect(s).not.toHaveProperty('userEdited');
      expect(s).not.toHaveProperty('warning');
    }
    const stored = await repository.loadProject('guard-2');
    expect(stored.settings.targetLang).toBe('fr');
    expect(stored.chapters[0]?.segments.every((s) => s.status === 'pending' && s.translationHtml === undefined)).toBe(true);
  });

  it('changes nothing while a job holds the lock in another tab', async () => {
    const project = await translatedBook('guard-3');
    const release = await holdLockElsewhere(jobLockName(project.id));
    try {
      expect(await updateSettingsAndResetTranslations(project, { targetLang: 'fr' })).toBe('busy');
    } finally {
      await release();
    }
    expect(project.settings.targetLang).toBe('vi');
    expect(project.chapters[0]?.segments[0]?.translationHtml).toBeDefined();
  });

  it('update_book_settings refuses a target change on a translated book unless a reset is requested and approved', async () => {
    const project = await translatedBook('guard-4');
    const refused = await tools.call('update_book_settings', { bookId: project.id, targetLang: 'fr' });
    expect(refused).toMatchObject({ ok: false });
    expect(String(refused.error)).toContain('already has 1 translated segments');
    expect(String(refused.hint)).toContain('resetTranslations: true');
    expect(project.settings.targetLang).toBe('vi');
    expect(tools.confirms).toHaveLength(0);

    tools.confirmAnswers.push(false);
    expect(await tools.call('update_book_settings', { bookId: project.id, targetLang: 'fr', resetTranslations: true })).toMatchObject({
      ok: true,
      changed: false,
      reason: 'declined',
    });
    expect(tools.confirms[0]).toContain('already has 1 segments translated into vi');
    expect(project.settings.targetLang).toBe('vi');

    const done = await tools.call('update_book_settings', { bookId: project.id, targetLang: 'fr', resetTranslations: true, twoPass: true });
    expect(done).toMatchObject({ ok: true, targetLang: 'fr', twoPass: true, translationsReset: true });
    expect(project.chapters[0]?.segments.every((s) => s.status === 'pending')).toBe(true);
  });

  it('update_book_settings rejects resetTranslations without a target change and changes untranslated books freely', async () => {
    const project = await translatedBook('guard-5');
    expect(await tools.call('update_book_settings', { bookId: project.id, twoPass: true, resetTranslations: true })).toMatchObject({ ok: false });
    await addProject(makeProject('guard-6', 2));
    expect(await tools.call('update_book_settings', { bookId: 'guard-6', targetLang: 'de' })).toMatchObject({ ok: true, targetLang: 'de' });
  });
});

describe('reasoning setting per provider', () => {
  it('is validated, kept per profile and applied to runs; default is not stored', () => {
    expect(parseProviderConfig({ providerId: 'openai', profiles: { openai: { baseURL: '', model: 'm', reasoning: 'low' } } })?.profiles.openai?.reasoning).toBe(
      'low',
    );
    expect(
      parseProviderConfig({ providerId: 'openai', profiles: { openai: { baseURL: '', model: 'm', reasoning: 'max' } } })?.profiles.openai,
    ).not.toHaveProperty('reasoning');
    const active = resolveActiveProvider({ providerId: 'openai', profiles: { openai: { baseURL: '', model: 'm', reasoning: 'off' } } });
    expect(active.reasoning).toBe('off');
    expect(settingsForRun(makeProject('r', 1).settings, active).reasoning).toBe('off');
    providerConfig.updateProfile('custom', { reasoning: 'default' });
    expect(providerConfig.store.get().profiles.custom).not.toHaveProperty('reasoning');
  });

  it('configure_provider passes the reasoning setting through without touching keys', async () => {
    const out = await tools.call('configure_provider', { providerId: 'custom', reasoning: 'low' });
    expect(out).toMatchObject({ ok: true, reasoning: 'low', keyPresent: true });
    expect(providerConfig.store.get().profiles.custom?.reasoning).toBe('low');
    expect(await tools.call('configure_provider', { providerId: 'custom', reasoning: 'max' })).toMatchObject({ ok: false });
  });
});

describe('identical-translation warnings', () => {
  it('index warned segments apart from errors, and a hand edit clears the warning', async () => {
    const project = await translatedBook('warn-1');
    expect(buildErrorIndex(project.chapters, isWarnedSegment).locations.map((l) => l.id)).toEqual(['s1']);
    expect(buildErrorIndex(project.chapters).locations.map((l) => l.id)).toEqual(['s2']);
    const segment = project.chapters[0]?.segments[0];
    if (!segment) throw new Error('fixture changed');
    await saveTranslationEdit(project, segment, 'Bản dịch mới');
    expect(segment).not.toHaveProperty('warning');
    const stored = await repository.loadSegmentState(project.id, segment.id);
    expect(stored).not.toHaveProperty('warning');
  });

  it('round-trips through storage rows and cross-tab refreshes', () => {
    expect(isSegmentStateRow({ projectId: 'p', id: 's', status: 'translated', translationHtml: 'x', warning: 'identical' })).toBe(true);
    expect(isSegmentStateRow({ projectId: 'p', id: 's', status: 'translated', warning: 'other' })).toBe(false);
    const live = { id: 's', sourceHtml: 'x', sourceText: 'x', status: 'translated' as const, translationHtml: 'x' };
    expect(applyStoredState(live, { status: 'translated', translationHtml: 'x' }, { projectId: 'p', ...live, warning: 'identical' })).toBe(true);
    expect(live).toMatchObject({ warning: 'identical' });
  });
});

describe('text books from URLs', () => {
  it('adds a text extension from the content type only when the name has no book extension', () => {
    expect(withTextExtension('download', 'text/plain; charset=utf-8')).toBe('download.txt');
    expect(withTextExtension('readme', 'text/markdown')).toBe('readme.md');
    expect(withTextExtension('pg1342.txt', 'application/octet-stream')).toBe('pg1342.txt');
    expect(withTextExtension('book.epub', 'text/plain')).toBe('book.epub');
    expect(withTextExtension('book', 'application/epub+zip')).toBe('book');
  });
});
