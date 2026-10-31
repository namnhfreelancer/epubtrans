import { createDefaultSettings, type Project, parseFrequencyList } from '@epubtrans/core';
import { describe, expect, it } from 'vitest';
import { computeWordHintsPlan, planForRun } from '../src/lib/word-hints-plan-cache';

const list = parseFrequencyList('en', `# test\n${Array.from({ length: 3000 }, (_, i) => `filler${i}`).join('\n')}\nperspicacious\ntruculent\n`);

function makeProject(): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id: 'p1',
    title: 'Book',
    createdAt: now,
    updatedAt: now,
    settings: createDefaultSettings({
      sourceLang: 'en',
      targetLang: 'vi',
      model: 'm',
      wordHints: { enabled: true, level: 5, style: 'ruby', maxPerParagraph: 3, perChapter: 1 },
    }),
    sourceEpub: new Uint8Array(),
    chapters: [{ href: 'ch1.xhtml', title: 'Chapter 1', segments: [{ id: 's1', sourceHtml: 'perspicacious truculent', sourceText: '', status: 'pending' }] }],
  };
}

describe('hints plan reuse on Generate', () => {
  it('reuses the scheduled plan while the project version and plan inputs are unchanged', () => {
    const project = makeProject();
    const cached = computeWordHintsPlan(project, list, 7, {});
    expect(cached.plan.candidates.map((c) => c.lemma)).toEqual(['perspicacious', 'truculent']);
    expect(cached.estimate.words).toBe(2);
    // Run settings add provider details (model, key) that do not change the plan.
    expect(planForRun(cached, project, list, { ...project.settings, model: 'other' }, 7)).toBe(cached.plan);
  });

  it('plans again when the project changed or the plan inputs differ', () => {
    const project = makeProject();
    const cached = computeWordHintsPlan(project, list, 7, {});
    project.wordHints = {
      sourceLang: 'en',
      glossLang: 'vi',
      entries: [
        {
          lemma: 'perspicacious',
          rank: 3001,
          senses: [{ id: 'main', gloss: 'x' }],
          occurrences: [{ segmentId: 's1', word: 'perspicacious', nth: 0, sense: 'main' }],
        },
      ],
    };
    const stale = planForRun(cached, project, list, project.settings, 8);
    expect(stale).not.toBe(cached.plan);
    expect(stale.candidates.map((c) => c.lemma)).toEqual(['truculent']);
    const level1 = { enabled: true, level: 1, style: 'ruby' as const, maxPerParagraph: 3, perChapter: 1 };
    const otherLevel = planForRun(cached, project, list, { ...project.settings, wordHints: level1 }, 7);
    expect(otherLevel).not.toBe(cached.plan);
    expect(planForRun(undefined, project, list, project.settings, 7)).not.toBe(cached.plan);
  });
});
