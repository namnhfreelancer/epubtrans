import { describe, expect, it } from 'vitest';
import { estimateCost, type GlossaryEntry, retranslateSegment, selectGlossaryEntries, translateProject } from '../src';
import {
  batchGlossary,
  buildPolishSystemPrompt,
  buildTranslateSystemPrompt,
  buildTranslateUserMessage,
  formatGlossaryEntry,
} from '../src/translate/prompt-protocol';
import { draftOf, neighbourLookup, plainText, polishContextOf, translateContextOf } from '../src/translate/read-only-context';
import { estimateTokens } from '../src/translate/token-estimate';
import { makeBatches } from '../src/translate/translate-project';
import type { Project } from '../src/types';
import { answerAll, makeProject, mockProvider, segment } from './test-helpers';

/**
 * Input tokens of `translateProject` computed the slow way: every request built and filtered like the real run, with
 * its read-only context (the source stands in for polish-context drafts that do not exist yet).
 */
function exactInputTokens(project: Project): number {
  const { settings } = project;
  const neighbours = neighbourLookup(project.chapters);
  let input = 0;
  for (const chapter of project.chapters) {
    for (const batch of makeBatches(chapter.segments.filter((s) => s.status === 'pending' || s.status === 'error')))
      input +=
        estimateTokens(buildTranslateSystemPrompt(settings, project)) +
        estimateTokens(buildTranslateUserMessage(batch, batchGlossary(settings.glossary, batch, 'translate'), translateContextOf(neighbours(batch))));
    for (const batch of makeBatches(chapter.segments.filter((s) => s.status !== 'reviewed'))) {
      input += estimateTokens(buildPolishSystemPrompt(settings, project));
      input += estimateTokens(JSON.stringify(polishContextOf(neighbours(batch), (s) => draftOf(s) ?? plainText(s.sourceText))));
      for (const s of batch)
        input += estimateTokens(s.sourceHtml) + 12 + Math.ceil(estimateTokens(s.translationHtml ?? s.sourceHtml) * (s.translationHtml ? 1 : 1.3));
      input += batchGlossary(settings.glossary, batch, 'review').reduce((n, g) => n + estimateTokens(formatGlossaryEntry(g)) + 2, 0);
    }
  }
  return input;
}

type Payload = { glossary?: string[]; segments: { id: string }[] };
const payload = (user: string) => JSON.parse(user) as Payload;

describe('selectGlossaryEntries', () => {
  const glossary: GlossaryEntry[] = [
    { term: 'Ann', translation: 'Ann' },
    { term: 'Anne', translation: 'Anne' },
    { term: 'New York', translation: 'Niu Oóc' },
    { term: "O'Brien", translation: 'O’Brien' },
    { term: '孙悟空', translation: 'Tôn Ngộ Không' },
    { term: 'Hogwarts', translation: 'Hogwarts' },
    { term: 'wand', translation: 'đũa phép' },
    { term: '', translation: 'ignored' },
  ];
  const terms = (source: string, draft?: string) => selectGlossaryEntries(glossary, source, draft).map((g) => g.term);

  it('matches case-insensitively on word boundaries for space-separated scripts', () => {
    expect(terms('anne smiled.')).toEqual(['Anne']);
    expect(terms('Ann and ANNE went to new   york.')).toEqual(['Ann', 'Anne', 'New York']);
    // Short inflectional endings are tolerated (see the inflection tests); "Ann" is too short for that.
    expect(terms('Annabella, Yorkshire, wanderer.')).toEqual([]);
    expect(terms('Mrs O’Brien arrived.')).toEqual(["O'Brien"]);
  });

  it('matches CJK terms as substrings', () => {
    expect(terms('第一天孙悟空来到花果山')).toEqual(['孙悟空']);
  });

  it('for a review also matches the term or its translation in the draft', () => {
    expect(terms('He waved it.', 'Cậu vẫy đũa phép ở Hogwarts.')).toEqual(['Hogwarts', 'wand']);
    expect(terms('He waved it.')).toEqual([]);
  });
});

describe('selectGlossaryEntries inflection tolerance', () => {
  const match = (term: string, text: string) => selectGlossaryEntries([{ term, translation: 'x' }], text).length === 1;

  it('matches plurals, possessives and declined forms of long enough words', () => {
    expect(match('Horcrux', 'He destroyed the Horcruxes.')).toBe(true);
    expect(match('Анна', 'Он увидел Анну вчера.')).toBe(true);
    expect(match('Анна', 'с Анной')).toBe(true);
    expect(match('effective altruist', 'Many effective altruists agree.')).toBe(true);
    expect(match('Darcy', 'the Darcys and the Bennets')).toBe(true);
    expect(match('Darcy', "Mr. Darcy's estate")).toBe(true);
    expect(match('Anna', 'Widziałem Annę.')).toBe(true);
    expect(match('Νίκος', 'το σπίτι του Νίκου')).toBe(true);
    expect(match('Анна Каренина', 'про Анну Каренину')).toBe(true);
  });

  it('does not match longer words, digits, or short terms', () => {
    expect(match('art', 'the artist painted')).toBe(false);
    expect(match('art', 'arts and crafts')).toBe(false);
    expect(match('Name1', 'Name10 waved')).toBe(false);
    expect(match('Name1', 'Name1s waved')).toBe(false);
    expect(match('Horcrux', 'Horcruxology')).toBe(false);
    expect(match('altruist', 'altruistically')).toBe(false);
    expect(match('effective altruist', 'effective, altruists')).toBe(false);
    expect(match('Hogwarts', 'Hogwarts2')).toBe(false);
    expect(match('孙悟空', '孙悟')).toBe(false);
  });

  it('keeps punctuation of a term attached to it', () => {
    expect(match('Mr.', 'Mr. Darcy')).toBe(true);
    expect(match('Mr.', 'mr.x')).toBe(false);
    expect(match('.NET', 'We use .NET daily')).toBe(true);
    expect(match('.NET', 'asp.net')).toBe(false);
    expect(match('C++', 'written in C++.')).toBe(true);
  });

  it('handles astral letters and mixed scripts', () => {
    // A mathematical script letter is outside Latin/Cyrillic/Greek: matched whole, as one word with its neighbours.
    expect(match('𝒜lpha', 'the 𝒜lpha wins')).toBe(true);
    expect(match('𝒜lpha', 'the 𝒜lphas')).toBe(false);
    expect(match('lpha', 'the 𝒜lpha wins')).toBe(false);
    expect(match('Hogwarts', '他去了Hogwarts学校')).toBe(false);
    expect(match('Hogwarts', '他去了 Hogwarts 学校')).toBe(true);
  });
});

describe('translation prompt glossary', () => {
  // 400 entries "Name0".."Name399": word boundaries keep "Name1" from matching "Name10".."Name199".
  const glossary: GlossaryEntry[] = Array.from({ length: 400 }, (_, i) => ({
    term: `Name${i}`,
    translation: `Tên${i}`,
    ...(i === 7 ? { note: 'nickname' } : {}),
  }));

  it('sends only the entries that occur in each batch, outside the cache-friendly system prompt', async () => {
    const project = makeProject([[segment('a', 'Name1 met <b>name7</b> in the hall.'), segment('b', 'Then Name250 left.')], [segment('c', 'Nobody came.')]]);
    project.settings.glossary = glossary;
    const provider = mockProvider(answerAll);
    await translateProject(project, provider, project.settings);
    expect(provider.calls).toHaveLength(2);
    const [first, second] = provider.calls.map((c) => payload(c.user));
    expect(first?.glossary).toEqual(['Name1 → Tên1', 'Name7 → Tên7 (nickname)', 'Name250 → Tên250']);
    expect(second?.glossary).toBeUndefined();
    expect(provider.calls[0]?.system).toBe(provider.calls[1]?.system);
    expect(provider.calls[0]?.system).not.toContain('Tên');
    expect(provider.calls[0]?.system).toContain('"glossary"');
  });

  it('review requests include entries matched in the source or in the draft', async () => {
    const project = makeProject([[segment('a', 'He left.', 'translated')]]);
    const first = project.chapters[0]?.segments[0];
    if (first) first.translationHtml = 'Tên3 rời đi.';
    project.settings = { ...project.settings, twoPass: true, glossary };
    const provider = mockProvider(answerAll);
    await translateProject(project, provider, project.settings);
    expect(payload(provider.calls[0]?.user ?? '{}').glossary).toEqual(['Name3 → Tên3']);
  });

  it('single-segment retranslation filters the glossary too', async () => {
    const project = makeProject([[segment('a', 'Name42 waved.')]]);
    project.settings.glossary = glossary;
    const provider = mockProvider(answerAll);
    await retranslateSegment(project, 'a', provider, project.settings);
    expect(payload(provider.calls[0]?.user ?? '{}').glossary).toEqual(['Name42 → Tên42']);
  });

  it('the cost estimate stays within a few percent of the exact per-batch glossary filter, in both passes', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Person${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`);
    const big: GlossaryEntry[] = names.map((n, i) => ({ term: i % 3 ? n : `${n} Smith`, translation: `${n} vi`, ...(i % 7 ? {} : { note: 'note' }) }));
    const chapters = Array.from({ length: 6 }, (_, c) =>
      Array.from({ length: 40 }, (_, k) => {
        const s = segment(
          `c${c}-${k}`,
          `<p>${names[(c * 7 + k) % 60]} Smith met ${names[(k * 13) % 60]}s near <b>the river</b> ${'and walked on '.repeat(k % 9)}.</p>`,
        );
        if (k % 3 === 0) {
          s.status = 'translated';
          s.translationHtml = s.sourceHtml.replace('river', 'sông');
        }
        return s;
      }),
    );
    const project = makeProject(chapters);
    project.settings = { ...project.settings, glossary: big, twoPass: true };
    const fast = estimateCost(project, project.settings).inputTokens;
    const exact = exactInputTokens(project);
    expect(Math.abs(fast - exact) / exact).toBeLessThan(0.05);
    // Cached facts must follow edits: a glossary change and a finished segment both change the result.
    project.settings = { ...project.settings, glossary: big.slice(0, 10) };
    expect(estimateCost(project, project.settings).inputTokens).toBeLessThan(fast);
  });

  it('the cost estimate grows only with relevant entries', () => {
    const project = makeProject([[segment('a', 'Nobody here.')]]);
    const without = estimateCost(project, project.settings).inputTokens;
    project.settings.glossary = glossary;
    expect(estimateCost(project, project.settings).inputTokens).toBe(without);
    project.chapters[0]?.segments.push(segment('b', 'Name5 arrived.'));
    project.settings.glossary = [];
    const plain = estimateCost(project, project.settings).inputTokens;
    project.settings.glossary = glossary;
    expect(estimateCost(project, project.settings).inputTokens).toBeGreaterThan(plain);
  });
});
