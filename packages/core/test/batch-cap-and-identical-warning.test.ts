import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '../src';
import {
  DEFAULT_MAX_BATCH_SEGMENTS,
  estimateCost,
  isIdenticalTranslation,
  loadProjectFile,
  makeBatches,
  maxSegmentsOf,
  retranslateSegment,
  saveProjectFile,
  translateProject,
  translateSample,
} from '../src';
import { answerAll, makeProject, mockProvider, segment } from './test-helpers';

const segmentsIn = (req: ChatRequest) => (JSON.parse(req.user) as { segments: unknown[] }).segments.length;
const shortLines = (n: number) => Array.from({ length: n }, (_, i) => segment(`c0-${i}`, `Line ${i}`));

/** Echoes every segment unchanged (an "untranslated" answer). */
const echoAll = (req: ChatRequest) => {
  const input = JSON.parse(req.user) as { segments: { id: string; html?: string; draft?: string }[] };
  return { text: JSON.stringify({ segments: input.segments.map((s) => ({ id: s.id, html: s.draft ?? s.html })) }) };
};

describe('segments per request cap', () => {
  it('caps batches at 32 segments by default and at the configured value, on top of the token budget', () => {
    expect(DEFAULT_MAX_BATCH_SEGMENTS).toBe(32);
    expect(makeBatches(shortLines(100)).map((b) => b.length)).toEqual([32, 32, 32, 4]);
    expect(makeBatches(shortLines(10), undefined, undefined, 4).map((b) => b.length)).toEqual([4, 4, 2]);
    expect(maxSegmentsOf({ maxSegmentsPerBatch: 0 })).toBe(32);
    expect(maxSegmentsOf({ maxSegmentsPerBatch: 7 })).toBe(7);
  });

  it('applies the cap to the translate and review passes, to samples and to the estimate', async () => {
    const project = makeProject([shortLines(70)]);
    const settings = { ...project.settings, twoPass: true, maxSegmentsPerBatch: 20 };
    const before = estimateCost(project, settings);
    const fewer = estimateCost(project, { ...settings, maxSegmentsPerBatch: 200 });
    // More requests repeat the system prompt more often.
    expect(before.inputTokens).toBeGreaterThan(fewer.inputTokens);
    const provider = mockProvider(answerAll);
    await translateProject(project, provider, settings);
    expect(provider.calls.map(segmentsIn)).toEqual([20, 20, 20, 10, 20, 20, 20, 10]);

    const sampleProject = makeProject([Array.from({ length: 60 }, (_, i) => segment(`c0-${i}`, `Word ${i} and some more words here.`))]);
    const sampler = mockProvider(answerAll);
    await translateSample(sampleProject, sampler, { ...sampleProject.settings, maxSegmentsPerBatch: 5 }, { passages: 1, wordsPerPassage: 100, seed: 1 });
    expect(Math.max(...sampler.calls.map(segmentsIn))).toBeLessThanOrEqual(5);
  });

  it('rejects an invalid cap before any request', async () => {
    const project = makeProject([shortLines(3)]);
    const provider = mockProvider(answerAll);
    await expect(translateProject(project, provider, { ...project.settings, maxSegmentsPerBatch: 0 })).rejects.toThrow(/between 1 and 200/);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('identical translation warning', () => {
  const langs = { sourceLang: 'en', targetLang: 'vi' };

  it('flags prose whose translation equals the source, ignoring case, spacing and punctuation', () => {
    expect(isIdenticalTranslation('The cat sat on the <em>mat</em>.', 'the cat sat on the <em>mat</em>', langs)).toBe(true);
    expect(isIdenticalTranslation('The cat sat on the mat.', 'Con mèo ngồi trên tấm thảm.', langs)).toBe(false);
  });

  it('ignores short, numeric, name-only and same-language text, and can be turned off', () => {
    expect(isIdenticalTranslation('Chapter 12', 'Chapter 12', langs)).toBe(false);
    expect(isIdenticalTranslation('1, 2, 3 — 4.5%', '1, 2, 3 — 4.5%', langs)).toBe(false);
    expect(isIdenticalTranslation('Elizabeth Bennet And Fitzwilliam Darcy', 'Elizabeth Bennet And Fitzwilliam Darcy', langs)).toBe(false);
    expect(isIdenticalTranslation('See https://example.com/a/very/long/path ok', 'See https://example.com/a/very/long/path ok', langs)).toBe(false);
    const prose = 'This sentence was never translated at all.';
    expect(isIdenticalTranslation(prose, prose, { sourceLang: 'en-GB', targetLang: 'en-US' })).toBe(false);
    expect(isIdenticalTranslation(prose, prose, { ...langs, identicalMinLetters: 0 })).toBe(false);
    expect(isIdenticalTranslation(prose, prose, { ...langs, identicalMinLetters: 500 })).toBe(false);
    expect(isIdenticalTranslation(prose, prose, { sourceLang: 'auto', targetLang: 'vi' })).toBe(true);
  });

  it('marks echoed segments with a warning that survives project files, and clears it on a real translation', async () => {
    const echoed = segment('c0-0', 'This sentence was never translated at all.');
    const fine = segment('c0-1', 'Another sentence that will be translated.');
    const project = makeProject([[echoed, fine]]);
    await translateProject(project, mockProvider(echoAll), project.settings);
    expect(echoed).toMatchObject({ status: 'translated', warning: 'identical', translationHtml: echoed.sourceHtml });
    expect(fine.warning).toBe('identical');

    const reloaded = await loadProjectFile(await saveProjectFile(project));
    expect(reloaded.chapters[0]?.segments[0]?.warning).toBe('identical');

    await retranslateSegment(project, 'c0-1', mockProvider(answerAll), project.settings);
    expect(fine.warning).toBeUndefined();
    expect(fine.translationHtml).toContain('[vi]');
  });

  it('clears a stale warning when a later run of the batch translator translates the segment for real', async () => {
    const echoed = segment('c0-0', 'This sentence was never translated at all.');
    const project = makeProject([[echoed]]);
    await translateProject(project, mockProvider(echoAll), project.settings);
    expect(echoed.warning).toBe('identical');
    // A reset sends the segment through the batch runner again (not through single-segment retranslation).
    echoed.status = 'pending';
    await translateProject(project, mockProvider(answerAll), project.settings);
    expect(echoed).toMatchObject({ status: 'translated' });
    expect(echoed.translationHtml).toContain('[vi]');
    expect(echoed).not.toHaveProperty('warning');
  });
});
