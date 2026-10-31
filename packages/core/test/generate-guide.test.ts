import { describe, expect, it } from 'vitest';
import {
  type ChatRequest,
  composeGuideline,
  GENERATED_GUIDELINE_HEADING,
  type GlossaryEntry,
  type GuideProgress,
  generateGuide,
  getGuidelinePreset,
  glossaryLimit,
  mergeGlossary,
  ProviderError,
  splitGuideline,
} from '../src';
import { parseGuidelineAnswer } from '../src/translate/generate-guide-guideline';
import { sampleBookPassages } from '../src/translate/generate-guide-passages';
import { makeProject, mockProvider, segment } from './test-helpers';

const isGuideline = (req: ChatRequest) => req.system.includes('preparing a book translation');
const candidatesOf = (req: ChatRequest) => JSON.parse(req.user.slice(req.user.indexOf('['))) as { term: string; count: number; contexts: string[] }[];
const SECTIONS = JSON.stringify({ sections: { genre: '- Fantasy for young adults', address: ['- Harry – Hermione: tớ – cậu'], tone: 'Light\n- Warm' } });

/** A book with `names` recurring names spread over `chapters` chapters; `padding` words make it longer. */
function book(names: number, chapters = 3, padding = 0) {
  const filler = ' and'.repeat(padding);
  const segs = Array.from({ length: chapters }, (_, c) =>
    Array.from({ length: names }, (_, i) =>
      segment(`c${c}-${i}`, `In the morning Hero${i} Lastname met Hero${i} Lastname at the gate and they talked${filler}.`),
    ),
  );
  return makeProject(segs);
}

/** Keeps every candidate as a person, translating it with a "vi:" prefix. */
const classifyAll = (req: ChatRequest) => ({
  text: JSON.stringify({ entries: candidatesOf(req).map((c) => ({ term: c.term, translation: `vi:${c.term}`, type: 'person' })) }),
});

describe('generateGuide', () => {
  it('extracts locally, writes a sectioned guideline that extends the preset, then classifies in batches', async () => {
    const project = book(60);
    const preset = getGuidelinePreset('fiction').guideline;
    project.settings = { ...project.settings, guideline: preset, concurrency: 2, glossary: [{ term: 'Gate', translation: 'Cổng (user)' }] };
    const provider = mockProvider((req) => (isGuideline(req) ? { text: SECTIONS } : classifyAll(req)));
    const progress: GuideProgress[] = [];
    const guide = await generateGuide(project, provider, project.settings, { onProgress: (p) => progress.push(p) });

    // Guideline: preset kept verbatim, generated block below it with every fixed section.
    expect(guide.guideline.startsWith(preset)).toBe(true);
    const { base, generated } = splitGuideline(guide.guideline);
    expect(base).toBe(preset);
    expect(generated).toContain(`${GENERATED_GUIDELINE_HEADING}\n\n### Genre & audience\n- Fantasy for young adults`);
    expect(generated).toContain('### Forms of address & pronouns\n- Harry – Hermione: tớ – cậu');
    expect(generated).toContain('### Tone & register\n- Light\n- Warm');
    expect(generated).toContain('### Footnotes\n- No book-specific rule; follow the base guideline.');
    const guidelineReq = provider.calls.find(isGuideline);
    expect(guidelineReq?.system).toContain(preset);
    expect(guidelineReq?.user).toContain('Hero0 Lastname');

    // Classification: 60 names → 60 candidates → one batch of 60 (limit 30 × 2 candidates per entry).
    const classifyCalls = provider.calls.filter((c) => !isGuideline(c));
    expect(classifyCalls.length).toBe(1);
    expect(classifyCalls[0]?.system).toContain('### Genre & audience'); // uses the new guideline
    const sent = candidatesOf(classifyCalls[0] as ChatRequest);
    expect(sent[0]?.contexts.length).toBeGreaterThan(0);
    expect(guide.candidates).toBe(sent.length);

    // Glossary: user entry kept, capped at the book-size limit, sorted by type then frequency.
    expect(guide.glossary).toHaveLength(glossaryLimit(0));
    expect(guide.glossary.at(-1)).toEqual({ term: 'Gate', translation: 'Cổng (user)' });
    expect(guide.glossary[0]).toMatchObject({ type: 'person', count: 6 });
    expect(progress.map((p) => p.phase)).toEqual(['extract', 'extract', 'guideline', 'guideline', 'glossary', 'glossary']);
    expect(progress.at(-1)).toEqual({ phase: 'glossary', done: sent.length, total: sent.length });
    expect(project.settings.guideline).toBe(preset); // settings are not modified
  });

  it('regenerating replaces only the previously generated block', async () => {
    const project = book(3);
    project.settings.guideline = composeGuideline('- My own rule', `${GENERATED_GUIDELINE_HEADING}\n\n### Old\n- stale`);
    const provider = mockProvider((req) => (isGuideline(req) ? { text: SECTIONS } : classifyAll(req)));
    const guide = await generateGuide(project, provider, project.settings);
    expect(guide.guideline.startsWith('- My own rule\n\n## Book-specific guideline')).toBe(true);
    expect(guide.guideline).not.toContain('stale');
    expect(provider.calls.find(isGuideline)?.system).not.toContain('stale');
  });

  it('classifies large candidate lists in batches of 80 and reports progress per batch', async () => {
    const project = book(200, 2, 300); // ~80k tokens: the limit is the 90-entry cap
    const provider = mockProvider((req) => (isGuideline(req) ? { text: SECTIONS } : classifyAll(req)));
    const progress: GuideProgress[] = [];
    const guide = await generateGuide(project, provider, project.settings, { maxEntries: 90, onProgress: (p) => progress.push(p) });
    const sizes = provider.calls.filter((c) => !isGuideline(c)).map((c) => candidatesOf(c).length);
    expect(sizes).toEqual([80, 80, 20]); // limit 90 → at most 180 candidates
    expect(progress.filter((p) => p.phase === 'glossary').map((p) => p.done)).toEqual([0, 80, 160, 180]);
    expect(guide.glossary).toHaveLength(90);
  });

  it('dedupes case- and diacritics-insensitively, keeps unknown types as "other" and skips an unusable batch', async () => {
    const project = book(200, 2, 300);
    let classifyCall = 0;
    const provider = mockProvider((req) => {
      if (isGuideline(req)) return { text: '{"guideline":"- Plain"}' };
      classifyCall++;
      if (classifyCall <= 2) return { text: 'not json at all' }; // first batch: both attempts fail
      return {
        text: JSON.stringify({
          entries: [
            { term: 'Đà Nẵng', translation: 'Đà Nẵng', type: 'PLACE' },
            { term: 'da nang', translation: 'dup' },
            { term: 'Widget', translation: 'thiết bị', type: 'gadget', note: ' tool ' },
            { term: '', translation: 'x' },
          ],
        }),
      };
    });
    const guide = await generateGuide(project, provider, { ...project.settings, guideline: '', concurrency: 1 }, { maxEntries: 90 });
    expect(guide.skippedBatches).toBe(1);
    expect(guide.guideline).toBe(`${GENERATED_GUIDELINE_HEADING}\n\n- Plain`);
    expect(guide.glossary).toEqual([
      { term: 'Đà Nẵng', translation: 'Đà Nẵng', type: 'place' },
      { term: 'Widget', translation: 'thiết bị', type: 'other', note: 'tool' },
    ]);
  });

  it('keeps the guideline and finished batches when one batch request keeps failing, and rejects when all do', async () => {
    const project = book(200, 2, 300);
    let classifyCall = 0;
    const provider = mockProvider((req) => {
      if (isGuideline(req)) return { text: '{"guideline":"- Plain"}' };
      classifyCall++;
      // Zero Retry-After keeps the test fast; the first batch fails on every retry.
      if (classifyCall <= 5) throw new ProviderError('overloaded', 529, 0);
      return { text: JSON.stringify({ entries: [{ term: 'Widget', translation: 'thiết bị', type: 'term' }] }) };
    });
    const guide = await generateGuide(project, provider, { ...project.settings, guideline: '', concurrency: 1 }, { maxEntries: 90 });
    expect(guide.skippedBatches).toBe(1);
    expect(guide.guideline).toContain('- Plain');
    expect(guide.glossary.map((g) => g.term)).toContain('Widget');

    const down = mockProvider((req) => {
      if (isGuideline(req)) return { text: '{"guideline":"- Plain"}' };
      throw new ProviderError('overloaded', 529, 0);
    });
    await expect(generateGuide(project, down, { ...project.settings, guideline: '', concurrency: 1 })).rejects.toThrow('overloaded');
  });

  it('propagates fatal provider errors and aborts', async () => {
    const project = book(3);
    const fatal = mockProvider(() => {
      throw new ProviderError('bad key', 401);
    });
    await expect(generateGuide(project, fatal, project.settings)).rejects.toThrow('bad key');
    const failing = mockProvider((req) => {
      if (isGuideline(req)) return { text: SECTIONS };
      throw new ProviderError('unknown model', 404);
    });
    await expect(generateGuide(project, failing, project.settings)).rejects.toThrow('unknown model');
    const controller = new AbortController();
    controller.abort();
    await expect(generateGuide(project, fatal, project.settings, { signal: controller.signal })).rejects.toThrow(/abort/i);
  });

  it('keeps a section the user appended below the generated block under its own heading', () => {
    const guideline = `Base rule.\n\n${GENERATED_GUIDELINE_HEADING}\n\n### Tone & register\n- Light\n\n## My rules\n- Never translate "Muggle".`;
    const { base, generated } = splitGuideline(guideline);
    expect(generated).toBe(`${GENERATED_GUIDELINE_HEADING}\n\n### Tone & register\n- Light`);
    expect(base).toBe('Base rule.\n\n## My rules\n- Never translate "Muggle".');
    expect(splitGuideline('Only base.')).toEqual({ base: 'Only base.', generated: '' });
  });

  it('rejects a guideline answer without content', () => {
    expect(() => parseGuidelineAnswer('{"sections":{}}')).toThrow(/no guideline/);
    expect(() => parseGuidelineAnswer('{"guideline":"  "}')).toThrow(/no guideline/);
  });
});

describe('glossary limits and merging', () => {
  it('scales the limit with book length within [30, cap]', () => {
    expect(glossaryLimit(0)).toBe(30);
    expect(glossaryLimit(130_000)).toBe(200); // ~100k-word novel
    expect(glossaryLimit(400_000)).toBe(400); // ~1000 pages
    expect(glossaryLimit(400_000, 1000)).toBe(616);
    expect(glossaryLimit(400_000, 10)).toBe(10);
    expect(glossaryLimit(1000, Number.NaN)).toBe(30);
  });

  it('keeps existing entries over generated duplicates and sorts by type, then frequency', () => {
    const existing: GlossaryEntry[] = [{ term: 'harry', translation: 'Harry (mine)' }];
    const generated: GlossaryEntry[] = [
      { term: 'Harry', translation: 'Harry', type: 'person', count: 50 },
      { term: 'magic', translation: 'phép thuật', type: 'term', count: 40 },
      { term: 'London', translation: 'Luân Đôn', type: 'place', count: 5 },
      { term: 'Hermione', translation: 'Hermione', type: 'person', count: 30 },
      { term: 'rare', translation: 'hiếm', type: 'term', count: 1 },
    ];
    expect(mergeGlossary(existing, generated, 4).map((e) => e.term)).toEqual(['Hermione', 'London', 'magic', 'harry']);
  });
});

describe('sampleBookPassages', () => {
  it('spreads passages over the whole book and returns a short book whole', () => {
    const long = makeProject(
      Array.from({ length: 40 }, (_, c) => Array.from({ length: 30 }, (_, i) => segment(`c${c}-${i}`, `Chapter ${c} paragraph ${i} ${'text '.repeat(40)}`))),
    );
    const passages = sampleBookPassages(long);
    expect(passages).toHaveLength(18);
    expect(passages[0]?.chapter).toBe('Chapter 1');
    expect(passages.at(-1)?.chapter).toBe('Chapter 38');
    const short = makeProject([[segment('a', 'One.'), segment('b', 'Two.')], [segment('c', 'Three.')]]);
    expect(sampleBookPassages(short).map((p) => p.text)).toEqual(['One.\nTwo.', 'Three.']);
  });
});
