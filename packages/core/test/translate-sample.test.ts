import { describe, expect, it } from 'vitest';
import {
  estimateSampleCost,
  loadProjectFile,
  type Project,
  ProviderError,
  saveProjectFile,
  selectSamplePassages,
  TOC_CHAPTER_TITLE,
  translateProject,
  translateSample,
} from '../src';
import { answerAll, fakeTranslate, makeProject, mockProvider, segment } from './test-helpers';

const WORDS_PER_SEGMENT = 30;
const sentence = (n: number) => Array.from({ length: WORDS_PER_SEGMENT }, (_, i) => `w${n}x${i}`).join(' ');

/** A TOC, a tiny dedication, and `chapters` real chapters of 40 segments (30 words each). */
function makeBook(chapters = 12): Project {
  const toc = [segment('c0-0', 'Chapter one'), segment('c0-1', 'Chapter two')];
  const dedication = [segment('c1-0', 'For my mother.')];
  const body = Array.from({ length: chapters }, (_, c) => Array.from({ length: 40 }, (_, i) => segment(`c${c + 2}-${i}`, `<p>${sentence(i)}</p>`)));
  const project = makeProject([toc, dedication, ...body]);
  const first = project.chapters[0];
  if (first) first.title = TOC_CHAPTER_TITLE;
  return project;
}

const idsOf = (selection: { passages: { segmentIds: string[] }[] }) => selection.passages.map((p) => p.segmentIds);
const requestedIds = (calls: { user: string }[]) => calls.flatMap((c) => (JSON.parse(c.user) as { segments: { id: string }[] }).segments.map((s) => s.id));

describe('selectSamplePassages', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const book = makeBook();
    const a = selectSamplePassages(book, { seed: 42 });
    expect(selectSamplePassages(book, { seed: 42 })).toEqual(a);
    expect(a.seed).toBe(42);
    expect(selectSamplePassages(book, { seed: 43 })).not.toEqual(a);
  });

  it('avoids back matter such as the index, notes and acknowledgments', () => {
    const book = makeBook(6);
    const titles = ['Index', 'Notes.', 'Acknowledgments', 'Bibliography', 'Примечания'];
    titles.forEach((title, i) => {
      const chapter = book.chapters[i + 2];
      if (chapter) chapter.title = title;
    });
    for (const seed of [1, 2, 3, 42]) {
      const picked = selectSamplePassages(book, { seed, passages: 5 }).passages.map((p) => p.chapterTitle);
      expect(picked.some((t) => titles.includes(t))).toBe(false);
    }
    // A book made only of such chapters still gets a sample.
    const odd = makeBook(1);
    const only = odd.chapters[2];
    if (only) only.title = 'Notes';
    expect(selectSamplePassages(odd, { seed: 1 }).passages[0]?.chapterTitle).toBe('Notes');
  });

  it('picks distinct chapters spread across the book, never the table of contents or a tiny chapter', () => {
    const book = makeBook();
    const hrefs = book.chapters.map((c) => c.href);
    for (const seed of [1, 2, 3, 99, 12345]) {
      const { passages } = selectSamplePassages(book, { seed, passages: 5 });
      expect(passages).toHaveLength(5);
      const used = passages.map((p) => hrefs.indexOf(p.chapterHref));
      expect(new Set(used).size).toBe(5);
      expect(used.every((i) => i >= 2)).toBe(true);
      // One chapter per fifth of the 12 usable chapters (indexes 2..13), in book order.
      expect(used).toEqual([...used].sort((x, y) => x - y));
      used.forEach((chapterIndex, slot) => {
        expect(chapterIndex - 2).toBeGreaterThanOrEqual(Math.floor((slot * 12) / 5));
        expect(chapterIndex - 2).toBeLessThan(Math.floor(((slot + 1) * 12) / 5));
      });
    }
  });

  it('takes a contiguous run of about the word budget', () => {
    const book = makeBook();
    for (const seed of [5, 6, 7, 8]) {
      for (const p of selectSamplePassages(book, { seed, wordsPerPassage: 350 }).passages) {
        const chapter = book.chapters.find((c) => c.href === p.chapterHref);
        const ids = chapter?.segments.map((s) => s.id) ?? [];
        const start = ids.indexOf(p.segmentIds[0] ?? '');
        expect(p.segmentIds).toEqual(ids.slice(start, start + p.segmentIds.length));
        // 350 words = 11.67 segments of 30 words: the run ends at the first segment that reaches the budget.
        expect(p.segmentIds).toHaveLength(12);
      }
    }
  });

  it('starts anywhere in the chapter that still leaves a full passage', () => {
    const book = makeBook(2);
    const starts = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      for (const p of selectSamplePassages(book, { seed, passages: 1, wordsPerPassage: 350 }).passages) {
        starts.add(Number((p.segmentIds[0] ?? '').split('-')[1]));
        expect(p.segmentIds.at(-1)).toMatch(/-(\d+)$/);
        expect(Number(/-(\d+)$/.exec(p.segmentIds.at(-1) ?? '')?.[1])).toBeLessThanOrEqual(39);
      }
    }
    expect(Math.max(...starts)).toBeGreaterThan(10);
    expect(Math.max(...starts)).toBeLessThanOrEqual(28);
  });

  it('returns fewer passages when the book has fewer usable chapters, and falls back for very short books', () => {
    expect(selectSamplePassages(makeBook(3), { seed: 1, passages: 5 }).passages).toHaveLength(3);
    const short = makeProject([[segment('a-0', 'Only a few words here.'), segment('a-1', 'And a few more.')]]);
    const { passages } = selectSamplePassages(short, { seed: 1 });
    expect(idsOf({ passages })).toEqual([['a-0', 'a-1']]);
  });

  it('rejects invalid options and books without text', () => {
    const book = makeBook();
    expect(() => selectSamplePassages(book, { passages: 0 })).toThrow(/passages/);
    expect(() => selectSamplePassages(book, { wordsPerPassage: 3 })).toThrow(/wordsPerPassage/);
    expect(() => selectSamplePassages(book, { seed: -1 })).toThrow(/seed/);
    expect(() => selectSamplePassages(makeProject([[]]))).toThrow(/no text/);
  });
});

describe('translateSample', () => {
  it('translates exactly the selected segments, persists them via onSegment and stores the selection', async () => {
    const book = makeBook();
    const provider = mockProvider(answerAll);
    const saved: string[] = [];
    const expected = selectSamplePassages(book, { seed: 7 });
    const result = await translateSample(book, provider, book.settings, { seed: 7, onSegment: (s) => saved.push(s.id) });

    expect(result).toEqual({ selection: expected, failed: [], keptEdited: [] });
    expect(book.lastSample).toEqual(expected);
    const ids = expected.passages.flatMap((p) => p.segmentIds);
    expect(requestedIds(provider.calls).sort()).toEqual([...ids].sort());
    expect(saved.sort()).toEqual([...ids].sort());
    for (const s of book.chapters.flatMap((c) => c.segments)) {
      expect(s.status).toBe(ids.includes(s.id) ? 'translated' : 'pending');
      if (ids.includes(s.id)) expect(s.translationHtml).toBe(fakeTranslate(s.sourceHtml));
    }
  });

  it('translates the sample again with the same seed even though it is already translated', async () => {
    const book = makeBook();
    const first = mockProvider(answerAll);
    const { selection } = await translateSample(book, first, book.settings, { seed: 11 });
    const ids = selection.passages.flatMap((p) => p.segmentIds);

    book.settings.guideline = 'New guideline';
    const second = mockProvider((req) => {
      const res = answerAll(req);
      return { ...res, text: res.text.replaceAll('[vi]', '[again]') };
    });
    const progress: number[] = [];
    const again = await translateSample(book, second, book.settings, { seed: 11, onProgress: (p) => progress.push(p.done) });
    expect(again.selection).toEqual(selection);
    expect(requestedIds(second.calls).sort()).toEqual([...ids].sort());
    expect(second.calls[0]?.system).toContain('New guideline');
    expect(progress.at(-1)).toBe(ids.length);
    for (const s of book.chapters.flatMap((c) => c.segments).filter((x) => ids.includes(x.id))) expect(s.translationHtml).toContain('[again]');
  });

  it('reuses a given selection and a following full run only sends the remaining segments', async () => {
    const book = makeBook(3);
    const { selection } = await translateSample(book, mockProvider(answerAll), book.settings, { seed: 3, passages: 2 });
    const done = new Set(selection.passages.flatMap((p) => p.segmentIds));

    const reuse = mockProvider(answerAll);
    await translateSample(book, reuse, book.settings, { selection });
    expect(new Set(requestedIds(reuse.calls))).toEqual(done);

    const full = mockProvider(answerAll);
    await translateProject(book, full, book.settings);
    const sent = requestedIds(full.calls);
    expect(sent.some((id) => done.has(id))).toBe(false);
    const total = book.chapters.flatMap((c) => c.segments).length;
    expect(sent.length + done.size).toBe(total);
  });

  it('reviews the sample too when two-pass is on', async () => {
    const book = makeBook(2);
    book.settings.twoPass = true;
    const provider = mockProvider(answerAll);
    const { selection } = await translateSample(book, provider, book.settings, { seed: 1, passages: 1 });
    const ids = selection.passages.flatMap((p) => p.segmentIds);
    const sentIds = requestedIds(provider.calls);
    expect(sentIds.length).toBe(ids.length * 2);
    expect(book.chapters.flatMap((c) => c.segments).filter((s) => ids.includes(s.id) && s.status === 'reviewed')).toHaveLength(ids.length);
  });

  it('leaves a segment the user edited during the run untouched', async () => {
    const book = makeBook(2);
    const probe = selectSamplePassages(book, { seed: 4, passages: 1 });
    const victimId = probe.passages[0]?.segmentIds[0] ?? '';
    const victim = book.chapters.flatMap((c) => c.segments).find((s) => s.id === victimId);
    const provider = mockProvider((req) => {
      if (victim && victim.status === 'pending') {
        victim.status = 'translated';
        victim.translationHtml = 'edited by hand';
      }
      return answerAll(req);
    });
    const saved: string[] = [];
    await translateSample(book, provider, book.settings, { seed: 4, passages: 1, onSegment: (s) => saved.push(s.id) });
    expect(victim?.translationHtml).toBe('edited by hand');
    expect(saved).not.toContain(victimId);
  });

  it('a failed sample run keeps existing translations and statuses and reports the failure', async () => {
    const book = makeBook(2);
    await translateProject(book, mockProvider(answerAll), book.settings);
    const { selection } = await translateSample(book, mockProvider(answerAll), book.settings, { seed: 5, passages: 1 });
    const ids = selection.passages.flatMap((p) => p.segmentIds);
    const sampled = book.chapters.flatMap((c) => c.segments).filter((s) => ids.includes(s.id));
    const [hand, ...rest] = sampled;
    if (!hand) throw new Error('empty sample');
    hand.translationHtml = '<p>MY CAREFUL EDIT</p>';
    hand.status = 'reviewed';
    const before = rest.map((s) => ({ ...s }));
    // A model that drops the markup fails validation for every segment.
    const broken = mockProvider((req) => {
      const input = JSON.parse(req.user) as { segments: { id: string }[] };
      return { text: JSON.stringify({ segments: input.segments.map((x) => ({ id: x.id, html: 'no tags' })) }) };
    });
    const saved: string[] = [];
    const result = await translateSample(book, broken, book.settings, { selection, onSegment: (s) => saved.push(s.id) });
    expect(result.failed.sort()).toEqual([...ids].sort());
    expect(saved).toEqual([]);
    expect(hand).toMatchObject({ status: 'reviewed', translationHtml: '<p>MY CAREFUL EDIT</p>' });
    expect(hand.error).toBeUndefined();
    expect(rest).toEqual(before);
  });

  it('a failed sample marks segments without a translation as errors', async () => {
    const book = makeBook(2);
    const outage = mockProvider(() => {
      // Retryable, with a zero Retry-After so the test does not wait for the backoff.
      throw new ProviderError('bad gateway', 502, 0);
    });
    const result = await translateSample(book, outage, book.settings, { seed: 6, passages: 1 });
    const ids = result.selection.passages.flatMap((p) => p.segmentIds);
    expect(result.failed.sort()).toEqual([...ids].sort());
    for (const s of book.chapters.flatMap((c) => c.segments).filter((x) => ids.includes(x.id))) expect(s.status).toBe('error');
  });

  it('skips segments the user edited by hand, in the run and in the estimate', async () => {
    const book = makeBook(2);
    const selection = selectSamplePassages(book, { seed: 8, passages: 1 });
    const ids = selection.passages.flatMap((p) => p.segmentIds);
    const all = estimateSampleCost(book, book.settings, selection);
    const edited = book.chapters.flatMap((c) => c.segments).find((s) => s.id === ids[0]);
    if (!edited) throw new Error('empty sample');
    Object.assign(edited, { status: 'translated', translationHtml: '<p>mine</p>', userEdited: true });
    expect(estimateSampleCost(book, book.settings, selection).inputTokens).toBeLessThan(all.inputTokens);
    const provider = mockProvider(answerAll);
    const result = await translateSample(book, provider, book.settings, { selection });
    expect(result.keptEdited).toEqual([edited.id]);
    expect(requestedIds(provider.calls)).not.toContain(edited.id);
    expect(edited).toMatchObject({ translationHtml: '<p>mine</p>', userEdited: true });
  });

  it('rejects when the stored selection does not match the book and when aborted', async () => {
    const book = makeBook(2);
    await expect(
      translateSample(book, mockProvider(answerAll), book.settings, {
        selection: { seed: 1, passages: [{ chapterHref: 'x', chapterTitle: 'x', segmentIds: ['nope'] }] },
      }),
    ).rejects.toThrow(/no longer matches/);
    const controller = new AbortController();
    controller.abort();
    await expect(translateSample(book, mockProvider(answerAll), book.settings, { seed: 1, signal: controller.signal })).rejects.toThrow();
  });

  it('estimates only the sampled segments, whatever their status', async () => {
    const book = makeBook();
    const selection = selectSamplePassages(book, { seed: 9 });
    const fresh = estimateSampleCost(book, book.settings, selection);
    await translateSample(book, mockProvider(answerAll), book.settings, { selection });
    expect(estimateSampleCost(book, book.settings, selection)).toEqual(fresh);
    expect(fresh.inputTokens).toBeGreaterThan(0);
    const wholeBook = makeBook();
    expect(fresh.inputTokens).toBeLessThan(
      estimateSampleCost(wholeBook, wholeBook.settings, selectSamplePassages(wholeBook, { seed: 9, passages: 12 })).inputTokens,
    );
  });
});

describe('project file with a stored sample', () => {
  it('round-trips the selection and still loads files without one', async () => {
    const book = makeBook(3);
    await translateSample(book, mockProvider(answerAll), book.settings, { seed: 21, passages: 2 });
    const loaded = await loadProjectFile(await saveProjectFile({ ...book, sourceEpub: new Uint8Array([1]) }));
    expect(loaded.lastSample).toEqual(book.lastSample);

    const { lastSample: _dropped, ...legacy } = book;
    const old = await loadProjectFile(await saveProjectFile({ ...legacy, sourceEpub: new Uint8Array([1]) }));
    expect(old.lastSample).toBeUndefined();
    expect('lastSample' in old).toBe(false);
  });
});
