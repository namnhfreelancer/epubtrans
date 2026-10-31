import 'fake-indexeddb/auto';
import { createDefaultSettings, type Project } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { repository } from '../src/lib/app-services';
import { updateHintSettings, updateSettings } from '../src/lib/project-settings-store';
import { addProject } from '../src/lib/project-store';
import { applySettingsUpdate, toSettingsUpdate } from '../src/lib/settings-field-changes';
import { makeProject } from './webmcp-test-support';

/** A second tab's view of a stored book: its own copy, loaded before the first tab changed anything. */
const staleCopy = (project: Project): Project => structuredClone(project);

describe('nested settings changes as field changes', () => {
  const base = createDefaultSettings({
    targetLang: 'vi',
    wordHints: { enabled: true, level: 3, style: 'ruby', maxPerParagraph: 3, perChapter: 1 },
    exportStyle: { preset: 'classic', source: { italic: true, opacity: 0.5 } },
    glossary: [
      { term: 'Ireland', translation: 'Ai-len' },
      { term: 'shilling', translation: 'si-linh', type: 'term' },
    ],
  });

  it('keeps top-level values whole and turns nested ones into the fields that changed', () => {
    const update = toSettingsUpdate(base, {
      model: 'm2',
      wordHints: { ...(base.wordHints as NonNullable<typeof base.wordHints>), level: 4 },
      exportStyle: { preset: 'classic', source: { italic: true } },
    });
    expect(update.patch).toEqual({ model: 'm2' });
    expect(update.changes).toEqual([
      { path: ['wordHints', 'level'], value: 4 },
      { path: ['exportStyle', 'source', 'opacity'], remove: true },
    ]);
  });

  it('merges the changes of two tabs that edited different fields', () => {
    const fromA = toSettingsUpdate(base, { exportStyle: { ...base.exportStyle, source: { italic: true, opacity: 0.8 } } });
    const fromB = toSettingsUpdate(base, { exportStyle: { ...base.exportStyle, blockSpacingEm: 1 } });
    const merged = applySettingsUpdate(applySettingsUpdate(base, fromA), fromB);
    expect(merged.exportStyle).toEqual({ preset: 'classic', source: { italic: true, opacity: 0.8 }, blockSpacingEm: 1 });
    // The input settings are never modified.
    expect(base.exportStyle).toEqual({ preset: 'classic', source: { italic: true, opacity: 0.5 } });
  });

  it('applies glossary edits by position, and the whole list of the tab when entries were added or removed meanwhile', () => {
    const editFirst = toSettingsUpdate(base, {
      glossary: [{ term: 'Ireland', translation: 'Ái Nhĩ Lan' }, base.glossary[1] as (typeof base.glossary)[number]],
    });
    const editSecond = toSettingsUpdate(base, {
      glossary: [base.glossary[0] as (typeof base.glossary)[number], { term: 'shilling', translation: 'đồng si-linh' }],
    });
    const both = applySettingsUpdate(applySettingsUpdate(base, editFirst), editSecond);
    expect(both.glossary).toEqual([
      { term: 'Ireland', translation: 'Ái Nhĩ Lan' },
      { term: 'shilling', translation: 'đồng si-linh' },
    ]);

    const added = applySettingsUpdate(base, toSettingsUpdate(base, { glossary: [...base.glossary, { term: 'Lilliput', translation: 'Lilliput' }] }));
    // An edit by position made against two entries never lands on another entry of a list that now has three.
    expect(applySettingsUpdate(added, editSecond).glossary).toEqual([
      { term: 'Ireland', translation: 'Ai-len' },
      { term: 'shilling', translation: 'đồng si-linh' },
    ]);
  });
});

describe('concurrent edits of nested settings in two tabs', () => {
  it('keeps both Word Wise option changes', async () => {
    const tabA = makeProject('nested-1');
    tabA.settings.wordHints = { enabled: true, level: 3, style: 'ruby', maxPerParagraph: 3, perChapter: 1 };
    await addProject(tabA);
    const tabB = staleCopy(tabA);
    await updateHintSettings(tabA, { level: 5 });
    await updateHintSettings(tabB, { style: 'inline' });
    const { settings } = await repository.loadSettings('nested-1');
    expect(settings.wordHints).toMatchObject({ enabled: true, level: 5, style: 'inline' });
  });

  it('keeps both export style changes and both glossary edits', async () => {
    const tabA = makeProject('nested-2');
    tabA.settings.glossary = [
      { term: 'Gulliver', translation: 'Gulliver' },
      { term: 'travels', translation: 'du ký' },
    ];
    await addProject(tabA);
    const tabB = staleCopy(tabA);
    await updateSettings(tabA, { exportStyle: { source: { italic: true } } });
    await updateSettings(tabB, { exportStyle: { blockSpacingEm: 1.5 } });
    await updateSettings(tabA, {
      glossary: [
        { term: 'Gulliver', translation: 'Gu-li-vơ' },
        { term: 'travels', translation: 'du ký' },
      ],
    });
    await updateSettings(tabB, {
      glossary: [
        { term: 'Gulliver', translation: 'Gulliver' },
        { term: 'travels', translation: 'du ký', note: 'title' },
      ],
    });
    const { settings } = await repository.loadSettings('nested-2');
    expect(settings.exportStyle).toEqual({ source: { italic: true }, blockSpacingEm: 1.5 });
    expect(settings.glossary).toEqual([
      { term: 'Gulliver', translation: 'Gu-li-vơ' },
      { term: 'travels', translation: 'du ký', note: 'title' },
    ]);
  });
});

describe('the settings revision', () => {
  it('is bumped by a new target language and by nothing else', async () => {
    await addProject(makeProject('revision-1'));
    const before = (await repository.loadSettings('revision-1')).revision;
    await repository.saveSettings('revision-1', { model: 'other' });
    await repository.saveSettings('revision-1', { targetLang: 'VI' });
    expect((await repository.loadSettings('revision-1')).revision).toBe(before);
    await repository.saveSettings('revision-1', { targetLang: 'de' });
    expect((await repository.loadSettings('revision-1')).revision).toBe(before + 1);
  });
});
