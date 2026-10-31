import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { importBook, loadProjectFile, planWordHints } from '@epubtrans/core';
import { domEnv } from '../src/dom-env';
import { run } from '../src/run';
import { loadFrequencyList } from '../src/word-frequency';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const SECRET = 'sk-test-secret-key';
const env = { EPUBTRANS_API_KEY: SECRET };
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function setup(onChat?: (call: number) => Response | undefined) {
  const server = startMockProvider(onChat);
  const { dir, input } = workDirWithFixture();
  cleanup.push(
    () => server.stop(),
    () => rmSync(dir, { recursive: true, force: true }),
  );
  return { server, dir, input, project: `${input}.epubtrans` };
}

const providerArgs = (server: MockProvider) => ['--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--concurrency', '1', '--yes'];
const readProject = async (path: string) => loadProjectFile(new Uint8Array(readFileSync(path)));
const lemmasSent = (server: MockProvider, from = 0) => [...new Set(server.calls.slice(from).flatMap((c) => c.lemmas ?? []))];

/** Source markup of every segment of an exported EPUB (re-imported through core). */
async function exportedSource(path: string): Promise<string> {
  const book = await importBook(new Uint8Array(readFileSync(path)), 'out.epub', domEnv);
  return book.chapters.flatMap((c) => c.segments.map((s) => s.sourceHtml)).join('\n');
}

describe('epubtrans hints', () => {
  test('generates glosses for a new book without translating it and saves them in the project file', async () => {
    const t = setup();
    const io = createTestIo({ env });
    const code = await run(['hints', t.input, '--gloss-lang', 'vi', '--level', '3', ...providerArgs(t.server)], io);
    expect(code).toBe(0);
    expect(io.stderr).toContain('Word Wise hints: level 3 (about B2 readers), glosses in vi');
    expect(io.stderr).toContain('Estimated usage');
    expect(io.stderr + io.stdout).not.toContain(SECRET);
    expect(t.server.calls.every((c) => c.lemmas !== undefined && c.authorization === `Bearer ${SECRET}`)).toBe(true);

    const project = await readProject(t.project);
    expect(project.settings.targetLang).toBe('vi');
    expect(project.settings.wordHints).toMatchObject({ enabled: true, level: 3, style: 'ruby' });
    expect(project.chapters.flatMap((c) => c.segments).every((s) => s.status === 'pending')).toBe(true);
    const lemmas = project.wordHints?.entries.map((e) => e.lemma) ?? [];
    expect(lemmas.length).toBeGreaterThan(50);
    expect([...lemmasSent(t.server)].sort()).toEqual([...lemmas].sort());
    expect(project.wordHints?.entries[0]?.senses[0]?.gloss).toBe(`≈${project.wordHints?.entries[0]?.lemma}`);

    // Export the original text with hints: ruby by default, inline on request; the project file is unchanged.
    const ruby = `${t.dir}/book.original.epub`;
    const exportIo = createTestIo();
    expect(await run(['export', t.project, '--mode', 'original', '--word-wise', '--out', ruby], exportIo)).toBe(0);
    const rubySource = await exportedSource(ruby);
    expect(rubySource).toMatch(/<ruby class="et-ww">[^<]+<rp> \(<\/rp><rt[^>]*>≈[^<]+<\/rt><rp>\)<\/rp><\/ruby>/);
    const inline = `${t.dir}/book.inline.epub`;
    expect(
      await run(['export', t.project, '--mode', 'original', '--hint-style', 'inline', '--hints-per-paragraph', '1', '--out', inline], createTestIo()),
    ).toBe(0);
    const inlineSource = await exportedSource(inline);
    expect(inlineSource).toContain('class="et-ww-i"');
    expect(inlineSource).not.toContain('<ruby');
    expect((await readProject(t.project)).settings.wordHints?.style).toBe('ruby');

    const only = createTestIo();
    expect(await run(['export', t.project, '--mode', 'translation-only', '--out', `${t.dir}/only.epub`], only)).toBe(0);
    expect(only.stderr).toContain('translation-only has no original text');
  });

  test('--glossary-file merges a glossary file into the project first, and names in it are never hinted', async () => {
    const t = setup();
    // A word the plan would gloss at level 1, with every form the book uses: as a person's name it must not be sent.
    const book = await importBook(new Uint8Array(readFileSync(t.input)), 'book.epub', domEnv);
    const settings = {
      ...book.settings,
      sourceLang: 'en',
      targetLang: 'vi',
      wordHints: { enabled: true, level: 1, style: 'ruby' as const, maxPerParagraph: 3, perChapter: 1 },
    };
    const candidate = planWordHints(book, await loadFrequencyList('en'), settings).candidates[0];
    if (!candidate) throw new Error('the fixture has no level-1 hint candidate');
    const forms = [...new Set(candidate.occurrences.map((o) => o.word.toLowerCase()))];
    const glossary = `${t.dir}/names.csv`;
    writeFileSync(glossary, ['term,translation,type,note', ...forms.map((f) => `${f[0]?.toUpperCase()}${f.slice(1)},${f},person,`)].join('\n'));

    const io = createTestIo({ env });
    const args = ['hints', t.input, '--from', 'en', '--gloss-lang', 'vi', '--level', '1', '--glossary-file', glossary, ...providerArgs(t.server)];
    expect(await run(args, io)).toBe(0);
    expect(io.stderr).toContain(`Glossary: ${forms.length} entries added from ${glossary}`);
    expect((await readProject(t.project)).settings.glossary.map((g) => g.term.toLowerCase())).toEqual(forms);
    const sent = lemmasSent(t.server);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent).not.toContain(candidate.lemma);

    // An invalid glossary file stops the command before any request.
    const bad = `${t.dir}/bad.tsv`;
    writeFileSync(bad, 'Fox\tCáo\nWolf\t\n');
    const calls = t.server.calls.length;
    const refused = createTestIo({ env });
    expect(await run(['hints', t.project, '--glossary-file', bad, ...providerArgs(t.server)], refused)).toBe(2);
    expect(refused.stderr).toContain('line 2: the translation of "Wolf" is empty');
    expect(t.server.calls.length).toBe(calls);
  });

  test('running it again sends nothing, a higher level sends only the new words, and an interrupted run resumes', async () => {
    let failOn = 2;
    const t = setup((call) => (call === failOn ? Response.json({ error: { message: 'invalid key' } }, { status: 401 }) : undefined));
    const first = createTestIo({ env });
    // The second request fails with a fatal error: the words of the first one are kept.
    expect(await run(['hints', t.input, '--gloss-lang', 'vi', '--level', '3', ...providerArgs(t.server)], first)).toBe(1);
    expect(first.stderr).toContain('invalid key');
    const partial = (await readProject(t.project)).wordHints?.entries.map((e) => e.lemma) ?? [];
    expect(partial.length).toBeGreaterThan(0);

    failOn = -1;
    const before = t.server.calls.length;
    expect(await run(['hints', t.project, ...providerArgs(t.server)], createTestIo({ env }))).toBe(0);
    const resent = lemmasSent(t.server, before);
    expect(resent.some((l) => partial.includes(l))).toBe(false);
    const complete = (await readProject(t.project)).wordHints?.entries.map((e) => e.lemma) ?? [];
    expect(complete.length).toBe(partial.length + resent.length);

    const again = createTestIo({ env });
    const callsBeforeAgain = t.server.calls.length;
    expect(await run(['hints', t.project, ...providerArgs(t.server)], again)).toBe(0);
    expect(again.stderr).toContain('Nothing to do');
    expect(t.server.calls.length).toBe(callsBeforeAgain);

    const higher = t.server.calls.length;
    expect(await run(['hints', t.project, '--level', '5', ...providerArgs(t.server)], createTestIo({ env }))).toBe(0);
    const added = lemmasSent(t.server, higher);
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((l) => complete.includes(l))).toBe(false);
    expect((await readProject(t.project)).settings.wordHints?.level).toBe(5);
  });

  test('a lemma glossed at a low level covers all its forms: raising or lowering the level later sends nothing for it', async () => {
    const t = setup();
    expect(await run(['hints', t.input, '--gloss-lang', 'vi', '--level', '1', ...providerArgs(t.server)], createTestIo({ env }))).toBe(0);
    // "profess" (rank ~31k) qualifies at level 1; its form "professed" (rank ~24.6k) does not, but is glossed with it.
    const entry = (await readProject(t.project)).wordHints?.entries.find((e) => e.lemma === 'profess');
    const forms = new Map(entry?.occurrences.map((o) => [o.word, o.rank]));
    expect(forms.get('profess')).toBeGreaterThan(25_000);
    expect(forms.get('professed')).toBeLessThanOrEqual(25_000);

    const higher = t.server.calls.length;
    expect(await run(['hints', t.project, '--level', '5', ...providerArgs(t.server)], createTestIo({ env }))).toBe(0);
    expect(lemmasSent(t.server, higher)).not.toContain('profess');

    const exportAt = async (level: number) => {
      const out = `${t.dir}/book.level${level}.epub`;
      const args = ['export', t.project, '--mode', 'original', '--hint-level', String(level), '--hints-per-chapter', '0', '--hints-per-paragraph', '0'];
      expect(await run([...args, '--out', out], createTestIo())).toBe(0);
      return exportedSource(out);
    };
    const low = await exportAt(1);
    expect(low).toContain('<ruby class="et-ww">profess<rp>');
    expect(low).not.toContain('<ruby class="et-ww">professed<rp>');
    expect(await exportAt(5)).toContain('<ruby class="et-ww">professed<rp>');
    const calls = t.server.calls.length;
    expect(await run(['hints', t.project, '--level', '1', ...providerArgs(t.server)], createTestIo({ env }))).toBe(0);
    expect(t.server.calls.length).toBe(calls);
  });

  test('translate --word-wise only applies existing hints (no gloss request) and keeps the option in the project', async () => {
    const t = setup();
    const out = `${t.dir}/book.vi.epub`;
    const io = createTestIo({ env });
    expect(await run(['translate', t.input, '--to', 'vi', '--word-wise', '--hint-style', 'inline', '--out', out, ...providerArgs(t.server)], io)).toBe(0);
    expect(t.server.calls.some((c) => c.lemmas !== undefined)).toBe(false);
    expect(io.stderr).toContain('no Word Wise hints were generated for this book yet');
    expect((await readProject(t.project)).settings.wordHints).toMatchObject({ enabled: true, style: 'inline' });

    expect(await run(['hints', t.project, ...providerArgs(t.server)], createTestIo({ env }))).toBe(0);
    const bilingual = `${t.dir}/book.hints.epub`;
    expect(await run(['export', t.project, '--out', bilingual], createTestIo())).toBe(0);
    const source = await exportedSource(bilingual);
    expect(source).toContain('class="et-ww-i"');
    expect(source).toContain('[vi] ');
  });

  test('usage errors exit with 2 and send nothing', async () => {
    const t = setup();
    for (const argv of [
      ['hints', t.input, ...providerArgs(t.server)],
      ['hints', t.input, '--gloss-lang', 'vi', '--level', '9', ...providerArgs(t.server)],
      ['hints', t.input, '--gloss-lang', 'vi', '--style', 'fancy', ...providerArgs(t.server)],
      ['hints', t.input, '--gloss-lang', 'vi', '--from', 'vi', ...providerArgs(t.server)],
      ['hints', t.input, '--gloss-lang', 'not a tag', ...providerArgs(t.server)],
      ['export', t.project, '--hint-level', '0'],
    ]) {
      const io = createTestIo({ env });
      expect(await run(argv, io)).toBe(2);
    }
    expect(t.server.calls.length).toBe(0);
    const help = createTestIo();
    expect(await run(['hints', '--help'], help)).toBe(0);
    expect(help.stdout).toContain('--gloss-lang');
    const declined = createTestIo({ env, interactive: true });
    expect(await run(['hints', t.input, '--gloss-lang', 'vi', ...providerArgs(t.server).filter((a) => a !== '--yes')], declined)).toBe(1);
    expect(declined.stderr).toContain('Cancelled');
    expect(t.server.calls.length).toBe(0);
  });
});
