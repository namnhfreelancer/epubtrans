import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateCost, ProviderError, retranslateSegment, translateProject } from '../src';
import { answerAll, fakeTranslate, makeProject, mockProvider, segment } from './test-helpers';

type Payload = { segments: { id: string; html?: string; draft?: string }[] };
const idsOf = (user: string) => (JSON.parse(user) as Payload).segments.map((s) => s.id);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('translateProject', () => {
  it('translates every pending segment in token-bounded batches and reports progress', async () => {
    const long = 'word '.repeat(700); // ~875 tokens each
    const project = makeProject([[segment('a', long), segment('b', long), segment('c', 'Short <b>bold</b> text.')], [segment('d', 'Next chapter.')]]);
    const provider = mockProvider(answerAll);
    const seen: string[] = [];
    const progress: number[] = [];
    await translateProject(project, provider, project.settings, {
      onSegment: (s) => seen.push(s.id),
      onProgress: (p) => progress.push(p.done),
    });
    expect(project.chapters.flatMap((c) => c.segments).every((s) => s.status === 'translated')).toBe(true);
    expect(project.chapters[0]?.segments[2]?.translationHtml).toBe(fakeTranslate('Short <b>bold</b> text.'));
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(progress.at(-1)).toBe(4);
    // Batches never mix chapters and stay near the 1500-token budget.
    const batches = provider.calls.map((c) => idsOf(c.user));
    expect(batches).toContainEqual(['d']);
    expect(batches.some((b) => b.includes('a') && b.includes('b'))).toBe(false);
    expect(provider.calls[0]?.system).toContain('Vietnamese');
  });

  it('respects the concurrency limit', async () => {
    const project = makeProject([Array.from({ length: 8 }, (_, i) => segment(`s${i}`, 'x '.repeat(3000)))]);
    project.settings.concurrency = 3;
    let inFlight = 0;
    let max = 0;
    const provider = mockProvider(async (req) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return answerAll(req);
    });
    await translateProject(project, provider, project.settings);
    expect(provider.calls.length).toBe(8);
    expect(max).toBe(3);
  });

  it('rejects answers that drop ids or inline tags and retries only those segments', async () => {
    const project = makeProject([[segment('a', 'Hello <b>world</b>'), segment('b', 'Plain text'), segment('c', 'A <a href="#x">link</a>')]]);
    const provider = mockProvider((req, call) => {
      if (call > 1) return answerAll(req);
      // Drops <b>, changes an attribute, and omits id "b".
      return {
        text: JSON.stringify({
          segments: [
            { id: 'a', html: 'Xin chào thế giới' },
            { id: 'c', html: 'Một <a href="#evil">liên kết</a>' },
          ],
        }),
      };
    });
    await translateProject(project, provider, project.settings);
    const segs = project.chapters[0]?.segments ?? [];
    expect(segs.map((s) => s.status)).toEqual(['translated', 'translated', 'translated']);
    expect(segs[0]?.translationHtml).toContain('<b>');
    expect(segs[2]?.translationHtml).toContain('href="#x"');
    expect(
      provider.calls
        .slice(1)
        .flatMap((c) => idsOf(c.user))
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  it('splits a batch in halves when the answer is not valid JSON', async () => {
    const project = makeProject([[segment('a', 'One.'), segment('b', 'Two.'), segment('c', 'Three.'), segment('d', 'Four.')]]);
    const provider = mockProvider((req, call) => (call === 1 ? { text: 'Sorry, here is your translation: {"segments": [' } : answerAll(req)));
    await translateProject(project, provider, project.settings);
    expect(provider.calls.map((c) => idsOf(c.user))).toEqual([
      ['a', 'b', 'c', 'd'],
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(project.chapters[0]?.segments.every((s) => s.status === 'translated')).toBe(true);
  });

  it('marks a segment as error after repeated invalid answers and continues', async () => {
    const project = makeProject([[segment('bad', 'Keep <i>this</i>'), segment('ok', 'Fine.')]]);
    const provider = mockProvider((req) => {
      const ids = idsOf(req.user);
      return { text: JSON.stringify({ segments: ids.map((id) => ({ id, html: id === 'bad' ? 'no tags' : 'Tốt.' })) }) };
    });
    await translateProject(project, provider, project.settings);
    const [bad, ok] = project.chapters[0]?.segments ?? [];
    expect(ok?.status).toBe('translated');
    expect(bad?.status).toBe('error');
    expect(bad?.error).toMatch(/tags/);
    expect(provider.calls.filter((c) => idsOf(c.user).join() === 'bad').length).toBe(3);
  });

  it('waits for Retry-After on 429 before retrying', async () => {
    vi.useFakeTimers();
    const project = makeProject([[segment('a', 'Hello.')]]);
    const provider = mockProvider((req, call) => {
      if (call === 1) throw new ProviderError('rate limited', 429, 7000);
      return answerAll(req);
    });
    const run = translateProject(project, provider, project.settings);
    await vi.advanceTimersByTimeAsync(6999);
    expect(provider.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(provider.calls.length).toBe(2);
    expect(project.chapters[0]?.segments[0]?.status).toBe('translated');
  });

  it('uses exponential backoff for 5xx and gives up after 5 attempts', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const project = makeProject([[segment('a', 'Hello.')]]);
    const provider = mockProvider(() => {
      throw new ProviderError('overloaded', 529);
    });
    const run = translateProject(project, provider, project.settings);
    await vi.advanceTimersByTimeAsync(999);
    expect(provider.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1 + 2000 + 4000 + 8000);
    await run;
    expect(provider.calls.length).toBe(5);
    expect(project.chapters[0]?.segments[0]?.status).toBe('error');
  });

  it('stops on fatal provider errors', async () => {
    const project = makeProject([[segment('a', 'One.')], [segment('b', 'Two.')]]);
    project.settings.concurrency = 1;
    const provider = mockProvider(() => {
      throw new ProviderError('invalid x-api-key', 401);
    });
    await expect(translateProject(project, provider, project.settings)).rejects.toThrow(/invalid x-api-key/);
    expect(provider.calls.length).toBe(1);
  });

  it('isolates a segment rejected with 4xx and stops when 4xx answers keep coming', async () => {
    const project = makeProject([[segment('a', 'Fine.'), segment('flagged', 'Blocked.')]]);
    const provider = mockProvider((req) => {
      if (idsOf(req.user).includes('flagged')) throw new ProviderError('content filtered', 400);
      return answerAll(req);
    });
    await translateProject(project, provider, project.settings);
    expect(project.chapters[0]?.segments.map((s) => s.status)).toEqual(['translated', 'error']);
    expect(provider.calls.length).toBe(3);

    const broken = makeProject([Array.from({ length: 8 }, (_, i) => segment(`s${i}`, `Text ${i}.`))]);
    broken.settings.concurrency = 1;
    const always400 = mockProvider(() => {
      throw new ProviderError('max_tokens is too large', 400);
    });
    await expect(translateProject(broken, always400, broken.settings)).rejects.toThrow(/max_tokens/);
    expect(always400.calls.length).toBe(5);
  });

  it('resumes without re-translating finished segments', async () => {
    const done = { ...segment('a', 'Done.', 'translated'), translationHtml: 'Xong.' };
    const project = makeProject([[done, segment('b', 'Todo.'), { ...segment('c', 'Failed.', 'error'), error: 'x' }]]);
    const provider = mockProvider(answerAll);
    await translateProject(project, provider, project.settings);
    expect(provider.calls.flatMap((c) => idsOf(c.user))).toEqual(['b', 'c']);
    expect(project.chapters[0]?.segments[0]?.translationHtml).toBe('Xong.');
    expect(project.chapters[0]?.segments[2]?.error).toBeUndefined();
  });

  it('runs the polish pass when twoPass is enabled', async () => {
    const project = makeProject([[segment('a', 'Hello <em>there</em>.'), { ...segment('b', 'Old.', 'translated'), translationHtml: 'Cũ.' }]]);
    project.settings.twoPass = true;
    const provider = mockProvider((req) => {
      if (!req.system.includes('literary editor')) return answerAll(req);
      const input = JSON.parse(req.user) as { segments: { id: string; source: string; draft: string }[] };
      return { text: JSON.stringify({ segments: input.segments.map((s) => ({ id: s.id, html: `${s.draft} ✓` })) }) };
    });
    const phases = new Set<string>();
    await translateProject(project, provider, project.settings, { onProgress: (p) => phases.add(p.phase) });
    const [a, b] = project.chapters[0]?.segments ?? [];
    expect(a?.status).toBe('reviewed');
    expect(a?.translationHtml).toBe(`${fakeTranslate('Hello <em>there</em>.')} ✓`);
    expect(b?.translationHtml).toBe('Cũ. ✓');
    expect([...phases]).toEqual(['translate', 'review']);
    const review = provider.calls.find((c) => c.system.includes('literary editor'));
    const polish = JSON.parse(review?.user ?? '{}');
    expect(polish.segments[0]).toMatchObject({ id: 'a', source: 'Hello <em>there</em>.' });
    expect(polish.chapter).toBe('Chapter 0');
  });

  it('rejects with an AbortError when aborted', async () => {
    const project = makeProject([[segment('a', 'x '.repeat(3000)), segment('b', 'y '.repeat(3000))]]);
    project.settings.concurrency = 1;
    const controller = new AbortController();
    const provider = mockProvider((req) => {
      controller.abort();
      return answerAll(req);
    });
    await expect(translateProject(project, provider, project.settings, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(provider.calls.length).toBe(1);
  });

  it('never overwrites or re-sends a segment edited while the run is in progress', async () => {
    const big = (w: string) => `${w} `.repeat(3000); // one segment per batch
    const project = makeProject([[segment('a', big('a')), segment('b', big('b')), segment('c', big('c'))]]);
    project.settings.concurrency = 1;
    const [a, b, c] = project.chapters[0]?.segments ?? [];
    if (!a || !b || !c) throw new Error('fixture');
    const persisted: string[] = [];
    const progress: number[] = [];
    const provider = mockProvider((req) => {
      // While "a" is in flight the user edits it, and edits "c" before its batch is sent.
      if (idsOf(req.user)[0] === 'a') {
        a.translationHtml = 'USER EDIT A';
        a.status = 'translated';
        c.translationHtml = 'USER EDIT C';
        c.status = 'translated';
      }
      return answerAll(req);
    });
    await translateProject(project, provider, project.settings, { onSegment: (s) => persisted.push(s.id), onProgress: (p) => progress.push(p.done) });
    expect([a.status, a.translationHtml]).toEqual(['translated', 'USER EDIT A']);
    expect([c.status, c.translationHtml]).toEqual(['translated', 'USER EDIT C']);
    expect([b.status, b.translationHtml?.startsWith('[vi] b')]).toEqual(['translated', true]);
    expect(provider.calls.map((call) => idsOf(call.user))).toEqual([['a'], ['b']]);
    expect(persisted).toEqual(['b']);
    expect(progress.at(-1)).toBe(3);
  });
});

describe('segments edited by hand', () => {
  const edited = (id: string, status: 'translated' | 'error' = 'translated') => ({
    ...segment(id, `Source ${id}.`, status),
    translationHtml: `Mine ${id}.`,
    userEdited: true,
  });

  it('are never re-sent or overwritten by a run or its review pass', async () => {
    const project = makeProject([[edited('a'), edited('b', 'error'), segment('c', 'Plain.')]]);
    project.settings.twoPass = true;
    const provider = mockProvider(answerAll);
    await translateProject(project, provider, project.settings);
    expect(provider.calls.flatMap((c) => idsOf(c.user))).toEqual(['c', 'c']);
    const [a, b] = project.chapters[0]?.segments ?? [];
    expect(a).toMatchObject({ status: 'translated', translationHtml: 'Mine a.', userEdited: true });
    expect(b).toMatchObject({ status: 'error', translationHtml: 'Mine b.', userEdited: true });
  });

  it('are left out of the estimate unless the caller asks to overwrite them', () => {
    // The edited segment comes last, so it is not read-only context of the other one's request either.
    const project = makeProject([[segment('c', 'Plain.'), edited('a', 'error')]]);
    const skipping = estimateCost(project, project.settings);
    const overwriting = estimateCost(project, project.settings, { overwriteUserEdited: true });
    expect(overwriting.inputTokens).toBeGreaterThan(skipping.inputTokens);
  });

  it('are translated again when the caller asks, which clears the flag', async () => {
    const project = makeProject([[edited('a', 'error')]]);
    await translateProject(project, mockProvider(answerAll), project.settings, { overwriteUserEdited: true });
    const [a] = project.chapters[0]?.segments ?? [];
    expect(a?.status).toBe('translated');
    expect(a?.userEdited).toBeUndefined();
  });

  it('a flagged segment without a translation is not protected, so it cannot stay pending forever', async () => {
    const project = makeProject([[{ ...segment('a', 'Source.'), userEdited: true }]]);
    await translateProject(project, mockProvider(answerAll), project.settings);
    expect(project.chapters[0]?.segments[0]?.status).toBe('translated');
  });

  it('retranslateSegment replaces a hand edit on success (clearing the flag) and keeps it on failure', async () => {
    const project = makeProject([[{ ...edited('a'), sourceHtml: 'Hi <b>you</b>' }]]);
    const broken = mockProvider(() => ({ text: '{"segments":[{"id":"a","html":"no tags"}]}' }));
    await expect(retranslateSegment(project, 'a', broken, project.settings)).rejects.toThrow();
    expect(project.chapters[0]?.segments[0]).toMatchObject({ translationHtml: 'Mine a.', userEdited: true });
    await retranslateSegment(project, 'a', mockProvider(answerAll), project.settings);
    expect(project.chapters[0]?.segments[0]?.userEdited).toBeUndefined();
    expect(project.chapters[0]?.segments[0]?.translationHtml).toBe(fakeTranslate('Hi <b>you</b>'));
  });
});

describe('retranslateSegment', () => {
  it('replaces the translation on success and keeps it on failure', async () => {
    const project = makeProject([[{ ...segment('a', 'Hi <b>you</b>', 'translated'), translationHtml: 'Old <b>x</b>' }]]);
    const ok = mockProvider(() => ({ text: '```json\n{"segments":[{"id":"a","html":"Chào <b>bạn</b>"}]}\n```' }));
    const updated = await retranslateSegment(project, 'a', ok, project.settings);
    expect(updated.translationHtml).toBe('Chào <b>bạn</b>');
    const broken = mockProvider(() => ({ text: '{"segments":[{"id":"a","html":"no tags"}]}' }));
    const failure = retranslateSegment(project, 'a', broken, project.settings);
    // The reason names the lost tag and carries no prefix: the UI adds its own "Retranslation failed".
    await expect(failure).rejects.toThrow(/missing <b>/);
    await expect(failure).rejects.not.toThrow(/Retranslation failed/);
    expect(project.chapters[0]?.segments[0]?.translationHtml).toBe('Chào <b>bạn</b>');
    await expect(retranslateSegment(project, 'missing', ok, project.settings)).rejects.toThrow(/Unknown segment/);
  });
});

describe('estimateCost', () => {
  it('estimates remaining tokens and USD from user prices', () => {
    const project = makeProject([[segment('a', 'word '.repeat(400)), { ...segment('b', 'done', 'translated'), translationHtml: 'xong' }]]);
    const noPrice = estimateCost(project, project.settings);
    expect(noPrice.inputTokens).toBeGreaterThan(500);
    expect(noPrice.outputTokens).toBeGreaterThan(500);
    expect(noPrice.usd).toBeUndefined();
    const priced = estimateCost(project, { ...project.settings, priceInPerM: 3, priceOutPerM: 15 });
    expect(priced.usd).toBeCloseTo((priced.inputTokens * 3 + priced.outputTokens * 15) / 1e6, 4);
    const twoPass = estimateCost(project, { ...project.settings, twoPass: true });
    expect(twoPass.inputTokens).toBeGreaterThan(noPrice.inputTokens);
  });
});

/** Simulates a real model: it drops empty page anchors when it restructures a sentence. */
function droppingModel(req: Parameters<typeof answerAll>[0]) {
  const input = JSON.parse(req.user) as { segments: { id: string; html?: string; draft?: string }[] };
  const drop = (html: string) => html.replace(/<a id="[^"]*"><\/a>/g, '');
  const segments = input.segments.map((s) => ({ id: s.id, html: s.draft !== undefined ? drop(s.draft) : fakeTranslate(drop(s.html ?? '')) }));
  return { text: JSON.stringify({ segments }) };
}

describe('empty page markers', () => {
  const source =
    'Nor would <a id="p49"></a>people who earn to give <sup class="endnote"><a href="notes.htm#en4-11" id="nr4-11">11</a></sup> be wrong.<a id="p50"></a>';

  it('are kept away from the model and restored in the translation', async () => {
    const project = makeProject([[segment('m', source)]]);
    const provider = mockProvider(droppingModel);
    await translateProject(project, provider, project.settings);
    const m = project.chapters[0]?.segments[0];
    expect(m?.status).toBe('translated');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.user).not.toContain('p49');
    expect(provider.calls[0]?.user).toContain('id=\\"nr4-11\\"');
    const html = m?.translationHtml ?? '';
    expect(html.match(/<a id="p49"><\/a>/g)).toHaveLength(1);
    // "[vi] Nor would people…": the marker lands at the word start nearest its source position.
    expect(html).toContain('would <a id="p49"></a>people');
    expect(html.endsWith('<a id="p50"></a>')).toBe(true);
    expect(html).toContain('<sup class="endnote"><a href="notes.htm#en4-11" id="nr4-11">');
  });

  it('survive the review pass, which sees neither the source nor the draft markers', async () => {
    const project = makeProject([[segment('m', source)]]);
    const provider = mockProvider(droppingModel);
    await translateProject(project, provider, { ...project.settings, twoPass: true });
    const m = project.chapters[0]?.segments[0];
    expect(m?.status).toBe('reviewed');
    expect(m?.error).toBeUndefined();
    const review = provider.calls[1]?.user ?? '';
    expect(review).toContain('"draft"');
    expect(review).not.toMatch(/p49|p50/);
    // The reviewer returned the draft unchanged, so the markers come back exactly where the draft had them.
    const draft = makeProject([[segment('m', source)]]);
    await translateProject(draft, mockProvider(droppingModel), draft.settings);
    expect(m?.translationHtml).toBe(draft.chapters[0]?.segments[0]?.translationHtml);
  });

  it('are restored by retranslateSegment', async () => {
    const project = makeProject([[{ ...segment('m', source, 'translated'), translationHtml: 'old' }]]);
    const updated = await retranslateSegment(project, 'm', mockProvider(droppingModel), project.settings);
    expect(updated.status).toBe('translated');
    expect(updated.translationHtml).toContain('<a id="p49"></a>');
    expect(updated.translationHtml).toContain('<a id="p50"></a>');
  });
});
