import 'fake-indexeddb/auto';
import { type ChatProvider, createDefaultSettings, type Project, parseFrequencyList, planWordHints } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { repository } from '../src/lib/app-services';
import { getHintJobState, hintLanguagesHold, isHintJobActive, startHintJob } from '../src/lib/hint-jobs';
import { SettingsChangedError } from '../src/lib/project-repository';
import { updateSettings } from '../src/lib/project-settings-store';
import { addProject } from '../src/lib/project-store';
import { eventually } from './webmcp-test-support';

// Node implements the Web Locks API, so the job lock behaves as in a browser tab.

/** Made-up rare words (no inflection-like endings), ranked after the filler words, so every one is a hint candidate. */
const RARE = Array.from({ length: 120 }, (_, i) => `zq${'bcdfgk'[Math.floor(i / 36) % 6]}${'bcdfgk'[Math.floor(i / 6) % 6]}${'bcdfgk'[i % 6]}`);
const list = parseFrequencyList('en', `# test\n${Array.from({ length: 3000 }, (_, i) => `filler${i}`).join('\n')}\n${RARE.join('\n')}\n`);

function makeProject(id: string): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id,
    title: 'Book',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({
      sourceLang: 'en',
      targetLang: 'vi',
      concurrency: 1,
      model: 'm',
      wordHints: { enabled: true, level: 5, style: 'ruby', maxPerParagraph: 3, perChapter: 1 },
    }),
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [{ href: 'ch1.xhtml', title: 'Chapter 1', segments: [{ id: 's1', sourceHtml: RARE.join(' '), sourceText: '', status: 'pending' }] }],
  };
}

/** Answers gloss requests right away, recording the gloss language of each; `onRequest` runs before answering. */
function glossProvider(onRequest: (n: number) => Promise<void> | void = () => {}) {
  const languages: string[] = [];
  const provider: ChatProvider = {
    listModels: async () => ['m'],
    chat: async (req) => {
      languages.push(/Gloss language: [^(\n]*\(([\w-]+)\)/.exec(req.system ?? '')?.[1] ?? '?');
      await onRequest(languages.length);
      const { items } = JSON.parse(req.user) as { items: { id: string; lemma: string }[] };
      return { text: JSON.stringify({ items: items.map((i) => ({ id: i.id, sense: 'main', gloss: `≈${i.lemma}` })) }) };
    },
  };
  return { provider, languages };
}

const storedLemmas = async (projectId: string) => (await repository.loadHints(projectId))?.entries.map((e) => e.lemma) ?? [];
const settled = (projectId: string) => eventually(() => !isHintJobActive(projectId) && getHintJobState(projectId).status !== 'running');

describe('a hints run and the book settings', () => {
  it('compares the target, source and gloss language with the plan', () => {
    const project = makeProject('hold-0');
    const plan = planWordHints(project, list, project.settings);
    const s = project.settings;
    expect(hintLanguagesHold(s, plan, { ...s, targetLang: 'VI' })).toBe(true);
    expect(hintLanguagesHold(s, plan, { ...s, targetLang: 'de' })).toBe(false);
    expect(hintLanguagesHold(s, plan, { ...s, sourceLang: 'fr' })).toBe(false);
    expect(hintLanguagesHold(s, plan, { ...s, wordHints: { ...(s.wordHints as NonNullable<typeof s.wordHints>), glossLang: 'en' } })).toBe(false);
  });

  it.each([
    ['target', { targetLang: 'de' }],
    ['source', { sourceLang: 'fr' }],
  ] as const)('re-reads the settings after taking the lock and sends nothing when another tab changed the %s language', async (_, change) => {
    const project = makeProject(`guard-1-${Object.keys(change)[0]}`);
    await addProject(project);
    const staleTab = structuredClone(project);
    await repository.saveSettings(project.id, change);
    const { provider, languages } = glossProvider();
    expect(await startHintJob(staleTab, planWordHints(staleTab, list, staleTab.settings), staleTab.settings, provider)).toBe('started');
    await settled(project.id);
    expect(getHintJobState(project.id)).toMatchObject({ status: 'failed', settingsChanged: true });
    expect(languages).toEqual([]);
    expect(staleTab.settings).toMatchObject(change);
    // Not even the language pair of the run was recorded.
    expect(await repository.loadHints(project.id)).toBeUndefined();
  });

  it('stops sending once the target language changes in this tab, and stores no gloss for the old language after it', async () => {
    const project = makeProject('guard-2');
    await addProject(project);
    let lemmasBeforeChange: string[] = [];
    const { provider, languages } = glossProvider(async (n) => {
      if (n !== 2) return;
      await eventually(async () => (await storedLemmas(project.id)).length === 40);
      lemmasBeforeChange = await storedLemmas(project.id);
      await updateSettings(project, { targetLang: 'de' });
    });
    expect(await startHintJob(project, planWordHints(project, list, project.settings), project.settings, provider)).toBe('started');
    await settled(project.id);
    expect(getHintJobState(project.id)).toMatchObject({ status: 'failed', settingsChanged: true });
    // The answer in flight during the change is discarded and the third batch is never requested.
    expect(languages).toEqual(['vi', 'vi']);
    expect(lemmasBeforeChange).toHaveLength(40);
    expect((await storedLemmas(project.id)).sort()).toEqual(lemmasBeforeChange.sort());
    // The live project drops the refused glosses too.
    expect(project.wordHints?.entries).toHaveLength(40);
  });

  it('discards the answer in flight when another tab changed the target language in storage', async () => {
    const project = makeProject('guard-3');
    await addProject(project);
    let lemmasBeforeChange: string[] = [];
    const { provider } = glossProvider(async (n) => {
      if (n !== 2) return;
      await eventually(async () => (await storedLemmas(project.id)).length === 40);
      lemmasBeforeChange = await storedLemmas(project.id);
      // Storage only: this tab has not heard about the change yet.
      await repository.saveSettings(project.id, { targetLang: 'de' });
    });
    expect(await startHintJob(project, planWordHints(project, list, project.settings), project.settings, provider)).toBe('started');
    await settled(project.id);
    expect(getHintJobState(project.id)).toMatchObject({ status: 'failed', settingsChanged: true });
    expect((await storedLemmas(project.id)).sort()).toEqual(lemmasBeforeChange.sort());
  });

  it('refuses to store a gloss once the gloss language changed, even with the same target language', async () => {
    const project = makeProject('guard-4');
    await addProject(project);
    const pair = { sourceLang: 'en', glossLang: 'vi' };
    const { revision } = await repository.loadSettings(project.id);
    const guard = { revision, targetLang: 'vi' };
    await repository.startHints(project.id, pair, false, guard);
    const entry = { lemma: 'zqbbb', rank: 3001, senses: [{ id: 'main', gloss: '≈' }], occurrences: [] };
    await repository.saveHintEntry(project.id, pair, entry, guard);
    await repository.saveSettings(project.id, {}, undefined, [{ path: ['wordHints', 'glossLang'], value: 'en' }]);
    await expect(repository.saveHintEntry(project.id, pair, { ...entry, lemma: 'zqbbc' }, guard)).rejects.toBeInstanceOf(SettingsChangedError);
    await expect(repository.startHints(project.id, pair, false, guard)).rejects.toBeInstanceOf(SettingsChangedError);
    expect(await storedLemmas(project.id)).toEqual(['zqbbb']);
  });
});
