import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectLanguage, exportEpub, importBook, loadProjectFile, saveProjectFile, validateProjectState } from '../src';
import { env, readFixture } from './test-helpers';

describe('project file', () => {
  it('round-trips state and source package, and the loaded project still exports', async () => {
    const project = await importBook(readFixture('aesop-fables.fb2'), 'aesop-fables.fb2', env);
    const first = project.chapters[1]?.segments[0];
    if (!first) throw new Error('fixture changed');
    first.status = 'translated';
    first.translationHtml = 'Ba truyện ngụ ngôn<br/>Bản dịch';
    project.settings.glossary = [{ term: 'fox', translation: 'cáo', note: 'animal' }];
    project.settings.priceInPerM = 1.5;

    const bytes = await saveProjectFile(project);
    const loaded = await loadProjectFile(bytes);
    expect(loaded).toEqual(project);
    expect(loaded.sourceEpub).toEqual(project.sourceEpub);
    const out = await exportEpub(loaded, 'bilingual', env);
    expect(out.byteLength).toBeGreaterThan(1000);
  });

  it('keeps typed glossary entries and still loads v3.0 entries without type or count', () => {
    const state = (glossary: unknown[]) => ({
      schemaVersion: 1,
      id: 'p',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: { sourceLang: 'en', targetLang: 'vi', providerId: 'openai', baseURL: '', model: '', concurrency: 1, twoPass: false, guideline: '', glossary },
      chapters: [],
    });
    const typed = { term: 'Harry', translation: 'Harry', type: 'person', count: 12, note: 'boy' };
    expect(validateProjectState(state([typed, { term: 'fox', translation: 'cáo' }])).settings.glossary).toEqual([typed, { term: 'fox', translation: 'cáo' }]);
    // An unknown (future) type is dropped instead of rejecting the file; a bad count is rejected.
    expect(validateProjectState(state([{ term: 'x', translation: 'y', type: 'species' }])).settings.glossary).toEqual([{ term: 'x', translation: 'y' }]);
    expect(() => validateProjectState(state([{ term: 'x', translation: 'y', count: -1 }]))).toThrow(/count must be a non-negative integer/);
  });

  it('keeps the optional userEdited flag, drops false, and rejects a non-boolean', () => {
    const state = (seg: Record<string, unknown>) => ({
      schemaVersion: 1,
      id: 'p',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      settings: {
        sourceLang: 'en',
        targetLang: 'vi',
        providerId: 'openai',
        baseURL: '',
        model: '',
        concurrency: 1,
        twoPass: false,
        guideline: '',
        glossary: [],
      },
      chapters: [
        { href: 'c.xhtml', title: 'C', segments: [{ id: 's', sourceHtml: 'x', sourceText: 'x', status: 'translated', translationHtml: 'y', ...seg }] },
      ],
    });
    const segmentOf = (seg: Record<string, unknown>) => validateProjectState(state(seg)).chapters[0]?.segments[0];
    expect(segmentOf({ userEdited: true })?.userEdited).toBe(true);
    expect(segmentOf({ userEdited: false })).not.toHaveProperty('userEdited');
    expect(segmentOf({})).not.toHaveProperty('userEdited');
    expect(() => segmentOf({ userEdited: 'yes' })).toThrow(/userEdited must be a boolean/);
  });

  it('rejects files that are not projects or have an invalid schema', async () => {
    await expect(loadProjectFile(strToU8('nope'))).rejects.toThrow(/zip/);
    await expect(loadProjectFile(zipSync({ 'other.txt': strToU8('x') }))).rejects.toThrow(/project file/);
    const bad = zipSync({ 'project.json': strToU8('{"schemaVersion":2}'), 'source.epub': new Uint8Array([1]) });
    await expect(loadProjectFile(bad)).rejects.toThrow(/schema version/);
    expect(() => validateProjectState({ schemaVersion: 1, id: 1 })).toThrow(/project.id must be a string/);
  });
});

describe('detectLanguage', () => {
  it('detects English from book text', async () => {
    const project = await importBook(readFixture('a-modest-proposal.epub'), 'a.epub', env);
    expect(detectLanguage(project)).toBe('en');
  });
});
