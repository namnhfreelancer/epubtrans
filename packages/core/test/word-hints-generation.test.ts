import { describe, expect, it } from 'vitest';
import {
  estimateWordHintsCost,
  GLOSS_BATCH_SIZE,
  generateProjectWordHints,
  generateWordHints,
  type HintCandidate,
  ProviderError,
  planWordHints,
  selectHintCandidates,
} from '../src';
import { cleanGloss, parseGlossAnswer } from '../src/word-hints/gloss-protocol';
import { type GlossItem, glossProvider, makeProject, mockProvider, rankedList, segment } from './test-helpers';

const langs = { sourceLang: 'en', glossLang: 'vi' };
const settings = { concurrency: 2 };
const list = rankedList('en', {
  the: 1,
  bank: 12_000,
  banks: 13_000,
  river: 100,
  money: 120,
  they: 2,
  sat: 300,
  on: 3,
  of: 4,
  a: 5,
  kept: 400,
  in: 6,
  with: 7,
});

function bankProject() {
  return makeProject([
    [segment('c0-0', 'They sat on the banks of the river.'), segment('c0-1', 'They kept money in a bank.')],
    [segment('c1-0', 'A bank with money.'), segment('c1-1', 'The bank of the river.'), segment('c1-2', 'The river bank.')],
  ]);
}

const candidatesOf = (project: ReturnType<typeof makeProject>) => selectHintCandidates(project, list, { level: 3 });

/** Sense by context: river banks vs money banks. */
const bySense = (item: GlossItem) =>
  item.context.includes('river') ? { sense: 'river edge', gloss: 'bờ sông' } : { sense: 'money institution', gloss: 'ngân hàng' };

describe('generateWordHints', () => {
  it('glosses a monosemous lemma once and applies the gloss to every occurrence', async () => {
    const project = makeProject([[segment('c0-0', 'Perspicacious minds.'), segment('c0-1', 'Very perspicacious.')], [segment('c1-0', 'Perspicacious!')]]);
    const words = rankedList('en', { perspicacious: 30_000, minds: 900, very: 10 });
    const provider = glossProvider();
    const result = await generateWordHints(selectHintCandidates(project, words, { level: 3 }), provider, settings, langs);
    expect(provider.calls).toHaveLength(1);
    const sent = JSON.parse(provider.calls[0]?.user ?? '{}') as { items: GlossItem[] };
    // Two sample contexts: the first occurrence and one from another chapter.
    expect(sent.items.map((i) => i.context)).toEqual(['⟦Perspicacious⟧ minds.', '⟦Perspicacious⟧!']);
    expect(result.entries).toEqual([
      {
        lemma: 'perspicacious',
        rank: 30_000,
        senses: [{ id: 'main', gloss: '≈perspicacious' }],
        occurrences: [
          { segmentId: 'c0-0', word: 'Perspicacious', nth: 0, sense: 'main', rank: 30_000 },
          { segmentId: 'c0-1', word: 'perspicacious', nth: 0, sense: 'main', rank: 30_000 },
          { segmentId: 'c1-0', word: 'Perspicacious', nth: 0, sense: 'main', rank: 30_000 },
        ],
      },
    ]);
    expect(result.usage).toEqual({ input: 50, output: 20 });
  });

  it('caches glosses per lemma and sense: a polysemous lemma gets a second round with the known senses', async () => {
    const project = bankProject();
    const provider = glossProvider(bySense);
    const result = await generateWordHints(candidatesOf(project), provider, settings, langs);
    expect(provider.calls).toHaveLength(2);
    const second = JSON.parse(provider.calls[1]?.user ?? '{}') as { items: GlossItem[] };
    expect(second.items.length).toBe(3);
    for (const item of second.items) {
      expect(item.senses).toEqual([
        { id: 'river edge', gloss: 'bờ sông' },
        { id: 'money institution', gloss: 'ngân hàng' },
      ]);
    }
    const [entry] = result.entries;
    expect(entry?.lemma).toBe('bank');
    expect(entry?.senses).toHaveLength(2);
    expect(entry?.occurrences.map((o) => `${o.segmentId}:${o.sense}`)).toEqual([
      'c0-0:river edge',
      'c0-1:money institution',
      'c1-0:money institution',
      'c1-1:river edge',
      'c1-2:river edge',
    ]);
  });

  it('keeps the first gloss of a sense when the model words it differently later', async () => {
    const project = bankProject();
    let n = 0;
    const provider = glossProvider((item) => ({ ...bySense(item), gloss: `${bySense(item).gloss} ${n++}` }));
    const result = await generateWordHints(candidatesOf(project), provider, settings, langs);
    const glosses = result.entries[0]?.senses.map((s) => s.gloss) ?? [];
    expect(glosses).toHaveLength(2);
    expect(new Set(glosses).size).toBe(2);
  });

  it('records words the model skips so they are never sent again', async () => {
    const project = makeProject([[segment('c0-0', 'Perspicacious minds.')]]);
    const words = rankedList('en', { perspicacious: 30_000, minds: 900 });
    const result = await generateWordHints(
      selectHintCandidates(project, words, { level: 3 }),
      glossProvider(() => ({ skip: true })),
      settings,
      langs,
    );
    expect(result.entries).toEqual([{ lemma: 'perspicacious', rank: 30_000, senses: [], occurrences: [] }]);
  });

  it('retries an unparsable answer once and items with unusable glosses once, then counts the lemma as failed', async () => {
    const project = makeProject([[segment('c0-0', 'Perspicacious and truculent minds.')]]);
    const words = rankedList('en', { perspicacious: 30_000, truculent: 31_000, and: 2, minds: 900 });
    const candidates = selectHintCandidates(project, words, { level: 3 });
    const provider = mockProvider((req, call) => {
      if (call === 1) return { text: 'Sorry, here you go: {"items": [' };
      const { items } = JSON.parse(req.user) as { items: GlossItem[] };
      const answer = items.map((i) =>
        i.word === 'truculent'
          ? { id: i.id, sense: 'x', gloss: 'a very long explanation that is not a short gloss at all' }
          : { id: i.id, sense: 'm', gloss: '<b>sắc sảo</b>' },
      );
      return { text: `\`\`\`json\n${JSON.stringify({ items: [...answer, { id: 'unknown', gloss: 'ignored' }] })}\n\`\`\`` };
    });
    const entries: string[] = [];
    const result = await generateWordHints(candidates, provider, settings, { ...langs, onEntry: (e) => entries.push(e.lemma) });
    // 1: broken JSON, 2: the batch again, 3: truculent alone (its gloss broke the caps).
    expect(provider.calls).toHaveLength(3);
    expect(JSON.parse(provider.calls[2]?.user ?? '{}').items.map((i: GlossItem) => i.word)).toEqual(['truculent']);
    expect(result.failed).toBe(1);
    expect(entries).toEqual(['perspicacious']);
    expect(result.entries[0]?.senses).toEqual([{ id: 'm', gloss: 'sắc sảo' }]);
  });

  it('gives up on a batch after two answers without JSON, so a broken model costs two requests', async () => {
    const project = makeProject([[segment('c0-0', 'Perspicacious minds.')]]);
    const words = rankedList('en', { perspicacious: 30_000, minds: 900 });
    const provider = mockProvider(() => ({ text: 'I cannot help with that.' }));
    const result = await generateWordHints(selectHintCandidates(project, words, { level: 3 }), provider, settings, langs);
    expect(provider.calls).toHaveLength(2);
    expect(result).toMatchObject({ entries: [], failed: 1 });
  });

  it('stops on a fatal provider error and on abort', async () => {
    const project = bankProject();
    const failing = mockProvider(() => {
      throw new ProviderError('bad key', 401);
    });
    await expect(generateWordHints(candidatesOf(project), failing, settings, langs)).rejects.toThrow('bad key');
    const controller = new AbortController();
    controller.abort();
    await expect(generateWordHints(candidatesOf(project), glossProvider(), settings, { ...langs, signal: controller.signal })).rejects.toThrow();
  });

  it('batches items, keeping the contexts of a lemma together', async () => {
    const words: Record<string, number> = {};
    const text = Array.from({ length: 30 }, (_, i) => {
      const w = `zword${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
      words[w] = 20_000 + i;
      return w;
    });
    const project = makeProject([[segment('c0-0', `${text.join(' ')}.`)], [segment('c1-0', `${text.join(' ')}.`)]]);
    const provider = glossProvider();
    const result = await generateWordHints(selectHintCandidates(project, rankedList('en', words), { level: 3 }), provider, settings, langs);
    expect(result.entries).toHaveLength(30);
    const sizes = provider.calls.map((c) => (JSON.parse(c.user) as { items: unknown[] }).items.length);
    expect(sizes).toEqual([GLOSS_BATCH_SIZE, 60 - GLOSS_BATCH_SIZE]);
  });
});

describe('gloss validation', () => {
  it('cleans glosses and rejects overlong or empty ones', () => {
    expect(cleanGloss('  "<i>bờ</i>  sông" ')).toBe('bờ sông');
    expect(cleanGloss('one two three four five six')).toBeUndefined();
    expect(cleanGloss('x'.repeat(41))).toBeUndefined();
    expect(cleanGloss('')).toBeUndefined();
    expect(cleanGloss(42)).toBeUndefined();
  });

  it('parses only requested ids and rejects answers without items', () => {
    const answers = parseGlossAnswer(
      '{"items":[{"id":"w0","sense":" River  Edge ","gloss":"bờ"},{"id":"w9","gloss":"x"},{"id":"w1","skip":true}]}',
      new Set(['w0', 'w1']),
    );
    expect([...answers]).toEqual([
      ['w0', { skip: false, sense: 'river edge', gloss: 'bờ' }],
      ['w1', { skip: true }],
    ]);
    expect(() => parseGlossAnswer('{"segments":[]}', new Set())).toThrow(/items/);
  });
});

describe('project hints: plan, resume, estimate', () => {
  it('sends only lemmas not glossed yet, and starts over for another gloss language', async () => {
    const project = bankProject();
    project.settings.wordHints = { enabled: true, level: 3, style: 'ruby', maxPerParagraph: 3, perChapter: 1 };
    const plan = planWordHints(project, list, project.settings);
    expect(plan.candidates.map((c) => c.lemma)).toEqual(['bank']);
    await generateProjectWordHints(project, plan, glossProvider(bySense), settings);
    expect(project.wordHints?.entries.map((e) => e.lemma)).toEqual(['bank']);
    expect(planWordHints(project, list, project.settings).candidates).toEqual([]);

    project.settings.wordHints.glossLang = 'fr';
    const replan = planWordHints(project, list, project.settings);
    expect(replan.reset).toBe(true);
    expect(replan.candidates).toHaveLength(1);
    const resets: string[] = [];
    await generateProjectWordHints(project, replan, glossProvider(), settings, { onReset: (h) => resets.push(h.glossLang) });
    expect(resets).toEqual(['fr']);
    expect(project.wordHints?.glossLang).toBe('fr');
    expect(project.wordHints?.entries).toHaveLength(1);
  });

  it('decides per occurrence: a glossed lemma sends only its missing occurrences, with its known senses, and merges them', async () => {
    const project = bankProject();
    project.settings.wordHints = { enabled: true, level: 3, style: 'ruby', maxPerParagraph: 3, perChapter: 1 };
    // An entry that covers only the first two occurrences (written by an older build, or before the text gained more).
    project.wordHints = {
      sourceLang: 'en',
      glossLang: 'vi',
      entries: [
        {
          lemma: 'bank',
          rank: 13_000,
          senses: [{ id: 'river edge', gloss: 'bờ sông' }],
          occurrences: [
            { segmentId: 'c0-0', word: 'banks', nth: 0, sense: 'river edge' },
            { segmentId: 'c0-1', word: 'bank', nth: 0, sense: 'river edge' },
          ],
        },
      ],
    };
    const plan = planWordHints(project, list, project.settings);
    expect(plan.total).toBe(1);
    expect(plan.candidates.map((c) => [c.lemma, c.occurrences.map((o) => o.segmentId), c.senses])).toEqual([
      ['bank', ['c1-0', 'c1-1', 'c1-2'], [{ id: 'river edge', gloss: 'bờ sông' }]],
    ]);
    const estimate = estimateWordHintsCost(plan.candidates, {}, langs);
    expect(estimate.requests).toBe(0);
    expect(estimate.inputTokens).toBeGreaterThan(0);

    const provider = glossProvider(bySense);
    await generateProjectWordHints(project, plan, provider, settings);
    // No first round: one request with the three missing contexts, each carrying the known sense.
    expect(provider.calls).toHaveLength(1);
    const sent = JSON.parse(provider.calls[0]?.user ?? '{}') as { items: GlossItem[] };
    expect(sent.items.map((i) => i.senses)).toEqual(Array(3).fill([{ id: 'river edge', gloss: 'bờ sông' }]));
    const [entry] = project.wordHints?.entries ?? [];
    expect(entry?.senses.map((x) => x.id)).toEqual(['river edge', 'money institution']);
    expect(entry?.occurrences.map((o) => `${o.segmentId}:${o.sense}`)).toEqual([
      'c0-0:river edge',
      'c0-1:river edge',
      'c1-0:money institution',
      'c1-1:river edge',
      'c1-2:river edge',
    ]);
    expect(planWordHints(project, list, project.settings).candidates).toEqual([]);
  });

  it('samples the forms that qualified at the level, not the common forms of the lemma', async () => {
    const words = rankedList('en', { frustrate: 28_000, frustrating: 7_000, it: 1, was: 2, a: 3, they: 4, me: 5 });
    const project = makeProject([[segment('c0-0', 'It was frustrating.'), segment('c0-1', 'They frustrate me.')], [segment('c1-0', 'It was frustrating.')]]);
    const candidates = selectHintCandidates(project, words, { level: 1 });
    expect(candidates.map((c) => c.lemma)).toEqual(['frustrate']);
    const provider = glossProvider();
    const result = await generateWordHints(candidates, provider, settings, langs);
    const sent = JSON.parse(provider.calls[0]?.user ?? '{}') as { items: GlossItem[] };
    expect(sent.items.map((i) => i.word)).toEqual(['frustrate']);
    expect(result.entries[0]?.occurrences.map((o) => [o.word, o.rank])).toEqual([
      ['frustrating', 7_000],
      ['frustrate', 28_000],
      ['frustrating', 7_000],
    ]);
  });

  it('estimates tokens and cost from the planned requests', () => {
    const candidates: HintCandidate[] = candidatesOf(bankProject());
    const estimate = estimateWordHintsCost(candidates, { priceInPerM: 3, priceOutPerM: 15 }, langs);
    expect(estimate.words).toBe(1);
    expect(estimate.occurrences).toBe(5);
    expect(estimate.requests).toBe(1);
    expect(estimate.inputTokens).toBeGreaterThan(200);
    expect(estimate.outputTokens).toBeGreaterThan(40);
    expect(estimate.usd).toBeGreaterThan(0);
    expect(estimateWordHintsCost([], {}, langs)).toMatchObject({ inputTokens: 0, outputTokens: 0, words: 0 });
    expect(estimateWordHintsCost(candidates, {}, langs).usd).toBeUndefined();
  });
});
