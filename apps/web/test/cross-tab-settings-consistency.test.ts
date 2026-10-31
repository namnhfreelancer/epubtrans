import 'fake-indexeddb/auto';
import type { ChatProvider, Project } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { repository } from '../src/lib/app-services';
import { runGuideJob } from '../src/lib/guide-jobs';
import { SETTINGS_CHANGED_MESSAGE } from '../src/lib/project-repository';
import { refreshSettingsFromStorage, updateSettings } from '../src/lib/project-settings-store';
import { addProject } from '../src/lib/project-store';
import { resolveActiveProvider } from '../src/lib/provider-config-store';
import { retranslateLiveSegment } from '../src/lib/retranslate-live-segment';
import { startSampleJob } from '../src/lib/sample-jobs';
import { getJobState, startJob } from '../src/lib/translation-jobs';
import type { ActiveProviderState } from '../src/lib/use-active-provider';
import { eventually, gate, makeProject } from './webmcp-test-support';

/** A second tab's view of a stored book: its own copy, loaded before the first tab changed anything. */
const staleCopy = (project: Project): Project => structuredClone(project);

/** Answers every segment with "[target] text"; the first answer waits for `held` when given. */
function recordingProvider(held?: Promise<void>) {
  const targets: string[] = [];
  const provider: ChatProvider = {
    listModels: async () => ['mock-model'],
    chat: async (req) => {
      const target = /Target language: [^(\n]*\(([\w-]+)\)/.exec(`${req.system}\n${req.user}`)?.[1] ?? '?';
      targets.push(target);
      if (held && targets.length === 1) await held;
      const { segments } = JSON.parse(req.user) as { segments: { id: string; html: string }[] };
      return { text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, html: `[${target}] ${s.html}` })) }) };
    },
  };
  return { provider, targets };
}

function providerState(chat: ChatProvider): ActiveProviderState {
  const active = resolveActiveProvider({ providerId: 'custom', profiles: { custom: { baseURL: 'https://mock.test/v1', model: 'mock-model' } } });
  return { active, apiKey: '', prepare: (project) => ({ provider: chat, settings: project.settings }), settingsFor: (book) => book };
}

const storedSegment = async (projectId: string, segmentId: string) => repository.loadSegmentState(projectId, segmentId);

describe('settings saved as patches', () => {
  it('never writes back a stale target language from another tab', async () => {
    const tabA = makeProject('patch-1');
    await addProject(tabA);
    const tabB = staleCopy(tabA);
    // Tab A changes the target; tab B (still showing vi) then saves an unrelated setting, as starting a run does.
    await updateSettings(tabA, { targetLang: 'de' });
    await updateSettings(tabB, { model: 'other-model' });
    const { settings } = await repository.loadSettings('patch-1');
    expect(settings).toMatchObject({ targetLang: 'de', model: 'other-model' });
    // Re-reading brings tab B up to date, keeping its own change.
    await refreshSettingsFromStorage(tabB);
    expect(tabB.settings).toMatchObject({ targetLang: 'de', model: 'other-model' });
  });
});

describe('runs re-read the settings from storage before sending', () => {
  it('a full run started from a stale tab translates into the stored target language', async () => {
    const tabA = makeProject('run-1', 2);
    await addProject(tabA);
    const tabB = staleCopy(tabA);
    await repository.saveSettingsAndResetSegments('run-1', { targetLang: 'de' });
    const { provider, targets } = recordingProvider();
    expect(await startJob(tabB, (book) => book, provider)).toBe('started');
    await eventually(() => getJobState('run-1').status === 'done');
    expect(new Set(targets)).toEqual(new Set(['de']));
    expect(tabB.settings.targetLang).toBe('de');
    expect((await storedSegment('run-1', 's1'))?.translationHtml).toContain('[de]');
  });

  it('a sample started from a stale tab uses the stored target language', async () => {
    const tabA = makeProject('sample-1', 2);
    await addProject(tabA);
    const tabB = staleCopy(tabA);
    await repository.saveSettings('sample-1', { targetLang: 'fr' });
    const { provider, targets } = recordingProvider();
    expect(await startSampleJob(tabB, (book) => book, provider, { passages: 1, seed: 1 })).toBe('started');
    await eventually(() => targets.length > 0);
    expect(targets[0]).toBe('fr');
  });

  it('a run whose target language changes in another tab stops and stores nothing in the old language', async () => {
    const project = makeProject('run-2', 3);
    await addProject(project);
    const held = gate();
    const { provider } = recordingProvider(held.promise);
    expect(await startJob(project, (book) => book, provider)).toBe('started');
    await eventually(async () => (await repository.loadSettings('run-2')).settings.targetLang === 'vi');
    // Another tab changes the target (no translations yet, so no reset was needed) while the first request is in flight.
    await repository.saveSettings('run-2', { targetLang: 'de' });
    held.open();
    await eventually(() => getJobState('run-2').status === 'failed');
    expect(getJobState('run-2').error).toBe(SETTINGS_CHANGED_MESSAGE);
    expect(await repository.loadSegmentStates('run-2')).toEqual(new Map());
    expect(project.chapters[0]?.segments.every((s) => s.status === 'pending' && s.translationHtml === undefined)).toBe(true);
  });
});

describe('a retranslation in flight during a target-language reset', () => {
  it('is discarded: storage keeps the reset state and the live segment follows it', async () => {
    const project = makeProject('retranslate-1', 2);
    const first = project.chapters[0]?.segments[0];
    if (!first) throw new Error('fixture changed');
    Object.assign(first, { status: 'translated', translationHtml: 'bản dịch cũ' });
    await addProject(project);
    const held = gate();
    const { provider, targets } = recordingProvider(held.promise);
    const pending = retranslateLiveSegment(project, 's1', providerState(provider));
    await eventually(() => targets.length === 1);
    expect(targets[0]).toBe('vi');
    // Another tab resets the book to German while the vi answer is on its way.
    await repository.saveSettingsAndResetSegments('retranslate-1', { targetLang: 'de' });
    held.open();
    expect(await pending).toEqual({ kind: 'settings-changed' });
    expect(await storedSegment('retranslate-1', 's1')).toBeUndefined();
    expect(first.status).toBe('pending');
    expect(first).not.toHaveProperty('translationHtml');
  });

  it('is discarded even when the target goes back to the same language (the reset revision changed)', async () => {
    const project = makeProject('retranslate-2', 1);
    await addProject(project);
    const held = gate();
    const { provider, targets } = recordingProvider(held.promise);
    const pending = retranslateLiveSegment(project, 's1', providerState(provider));
    await eventually(() => targets.length === 1);
    await repository.saveSettingsAndResetSegments('retranslate-2', { targetLang: 'de' });
    await repository.saveSettingsAndResetSegments('retranslate-2', { targetLang: 'vi' });
    held.open();
    expect(await pending).toEqual({ kind: 'settings-changed' });
    expect(await storedSegment('retranslate-2', 's1')).toBeUndefined();
  });

  it('is saved when nothing changed meanwhile', async () => {
    const project = makeProject('retranslate-3', 1);
    await addProject(project);
    const { provider } = recordingProvider();
    const outcome = await retranslateLiveSegment(project, 's1', providerState(provider));
    expect(outcome.kind).toBe('saved');
    expect((await storedSegment('retranslate-3', 's1'))?.translationHtml).toContain('[vi]');
  });
});

describe('a generated guide', () => {
  it('is not saved when the target language changed while it was generated', async () => {
    const project = makeProject('guide-1', 2);
    await addProject(project);
    const held = gate();
    let calls = 0;
    const provider: ChatProvider = {
      listModels: async () => ['mock-model'],
      chat: async (req) => {
        calls++;
        await held.promise;
        if (req.system.includes('terminology editor'))
          return { text: JSON.stringify({ entries: [{ term: 'Gulliver', translation: 'Gu-li-vơ', type: 'person' }] }) };
        return { text: JSON.stringify({ sections: { genre: '- Mock genre.' } }) };
      },
    };
    const run = runGuideJob(project, () => ({ provider, settings: project.settings }));
    await eventually(() => calls > 0);
    await repository.saveSettings('guide-1', { targetLang: 'de' });
    held.open();
    const result = await run;
    expect(result).toMatchObject({ kind: 'error', message: SETTINGS_CHANGED_MESSAGE });
    const { settings } = await repository.loadSettings('guide-1');
    expect(settings.targetLang).toBe('de');
    expect(settings.guideline).not.toContain('Mock genre');
    expect(settings.glossary).toEqual([]);
    expect(project.settings.glossary).toEqual([]);
  });
});
