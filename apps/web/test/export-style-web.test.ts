import 'fake-indexeddb/auto';
import { ExportStyleError, exportStylePreset, serializeStyleTemplates } from '@epubtrans/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STYLE_MESSAGES } from '../src/components/export-style/export-style-messages';
import { choicesWith, formatByteSize, ignoredKeysText, optionalWeight, patchBlockSpacing, patchStyleGroup } from '../src/lib/export-style-edit';
import { ProjectDatabase } from '../src/lib/project-database';
import { createStyleTemplateStore, DuplicateTemplateNameError, type StyleTemplateStore } from '../src/lib/style-template-store';

let db: ProjectDatabase;
let store: StyleTemplateStore;

beforeEach(() => {
  db = new ProjectDatabase(`templates-${Math.random()}`);
  store = createStyleTemplateStore(db);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('style template store', () => {
  it('saves, lists by name, renames and deletes templates; names are unique ignoring case', async () => {
    const b = await store.save(' Beta ', { source: { opacity: 0.4 } });
    await store.save('alpha', exportStylePreset('learner'));
    expect((await store.list()).map((t) => t.name)).toEqual(['alpha', 'Beta']);
    await expect(store.save('BETA', {})).rejects.toBeInstanceOf(DuplicateTemplateNameError);
    await store.save('BETA', { blockSpacingEm: 1 }, { overwrite: true });
    expect((await store.findByName('beta'))?.style).toEqual({ blockSpacingEm: 1 });
    await expect(store.rename(b.id, 'ALPHA')).rejects.toBeInstanceOf(DuplicateTemplateNameError);
    await store.rename(b.id, 'Gamma');
    expect((await store.list()).map((t) => t.name)).toEqual(['alpha', 'Gamma']);
    await store.remove(b.id);
    expect((await store.list()).map((t) => t.name)).toEqual(['alpha']);
  });

  it('validates names and styles before saving', async () => {
    await expect(store.save('', {})).rejects.toBeInstanceOf(ExportStyleError);
    await expect(store.save('x', { source: { color: 'red}' } })).rejects.toBeInstanceOf(ExportStyleError);
    expect(await store.list()).toEqual([]);
  });

  it('skips stored rows that fail validation', async () => {
    await db.styleTemplates.put({ id: 'bad', name: 'Tampered', style: { source: { color: 'url(x)' } }, updatedAt: '' });
    await store.save('Good', {});
    expect((await store.list()).map((t) => t.name)).toEqual(['Good']);
  });

  it('exports and imports template files, renaming taken names', async () => {
    await store.save('Mine', { translation: { fontWeight: 'bold' } });
    const file = await store.exportJson();
    const { added, ignoredKeys } = await store.importJson(file);
    expect(added.map((t) => t.name)).toEqual(['Mine (2)']);
    expect(ignoredKeys).toEqual([]);
    expect((await store.findByName('Mine (2)'))?.style).toEqual({ translation: { fontWeight: 'bold' } });
    await expect(
      store.importJson('{"format":"epubtrans-style-templates","version":1,"templates":[{"name":"x","style":{"source":{"color":"}"}}}]}'),
    ).rejects.toBeInstanceOf(ExportStyleError);
    await expect(store.importJson('{}')).rejects.toThrow(/Not an epubtrans style template file/);
    const one = await store.exportJson([(await store.findByName('Mine'))?.id ?? '']);
    expect(one).toBe(serializeStyleTemplates([{ name: 'Mine', style: { translation: { fontWeight: 'bold' } } }]));
  });

  it('imports files from a newer version without the keys it does not know, and names them', async () => {
    const newer = `\uFEFF{"format":"epubtrans-style-templates","version":1,"templates":[{"name":"New","style":{"css":"}","hint":{"color":"#000"}}}]}`;
    const { added, ignoredKeys } = await store.importJson(newer);
    expect(added.map((t) => t.style)).toEqual([{ hint: { color: '#000000' } }]);
    expect(ignoredKeys).toEqual(['templates[0].style.css']);
    expect(ignoredKeysText(['a', 'b', 'c'], 2)).toBe('a, b (+1)');
  });
});

describe('style editor choices', () => {
  it('include a valid value set elsewhere, so the select does not fall back to "Default"', () => {
    expect(choicesWith([90, 100, 110], 113)).toEqual([90, 100, 110, 113]);
    expect(choicesWith([90, 100, 110], 95)).toEqual([90, 95, 100, 110]);
    expect(choicesWith([90, 100], 100)).toEqual([90, 100]);
    expect(choicesWith([90, 100], undefined)).toEqual([90, 100]);
    expect(choicesWith<string | number>(['normal', 'bold', 300], 800)).toEqual(['normal', 'bold', 300, 800]);
  });
});

describe('style editing helpers', () => {
  it('patches one field, drops the preset label and empty groups', () => {
    const learner = exportStylePreset('learner');
    const edited = patchStyleGroup(learner, 'hint', 'color', '#ABCDEF');
    expect(edited.preset).toBeUndefined();
    expect(edited.hint).toEqual({ color: '#abcdef', fontSizePercent: 65 });
    expect(patchStyleGroup({ source: { italic: true } }, 'source', 'italic', undefined)).toEqual({});
    expect(patchBlockSpacing({ blockSpacingEm: 1, preset: 'minimal' }, undefined)).toEqual({});
    expect(patchBlockSpacing(undefined, 0.5)).toEqual({ blockSpacingEm: 0.5 });
    expect(() => patchStyleGroup(undefined, 'source', 'opacity', 5)).toThrow(ExportStyleError);
    expect(optionalWeight('600')).toBe(600);
    expect(optionalWeight('bold')).toBe('bold');
    expect(optionalWeight('')).toBeUndefined();
  });

  it('formats sizes', () => {
    expect(formatByteSize(288_392, 'en')).toBe('288 KB');
    expect(formatByteSize(1_250_000, 'en')).toBe('1.3 MB');
    expect(formatByteSize(1_250_000, 'vi')).toBe('1,3 MB');
  });

  it('has the same style strings and placeholders in every locale', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = STYLE_MESSAGES.en;
    for (const messages of Object.values(STYLE_MESSAGES)) {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), key).not.toBe('');
        expect(placeholders(value), key).toEqual(placeholders(en[key as keyof typeof en]));
      }
    }
  });
});
