import { describe, expect, it } from 'vitest';
import { estimateCost, type GlossaryEntry, retranslateSegment, selectGlossaryEntries, translateProject } from '../src';
import { answerAll, makeProject, mockProvider, segment } from './test-helpers';

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
    expect(terms('Annex, Yorkshire, wands.')).toEqual([]);
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
