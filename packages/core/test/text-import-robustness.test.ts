import { describe, expect, it } from 'vitest';
import { importBook } from '../src';
import { createXhtmlDocument } from '../src/dom/xhtml-document';
import { NS } from '../src/dom/xml-dom-helpers';
import { MAX_QUOTE_DEPTH } from '../src/formats/markdown-blocks';
import { splitFrontMatter } from '../src/formats/markdown-front-matter';
import { renderInline } from '../src/formats/markdown-inline';
import { markdownToEpub } from '../src/formats/markdown-to-epub';
import { MAX_SEGMENT_TOKENS, splitLongText } from '../src/formats/split-long-text';
import { estimateTokens } from '../src/translate/token-estimate';
import { env, unzipText } from './test-helpers';

type Project = Awaited<ReturnType<typeof importBook>>;
const encode = (text: string) => new TextEncoder().encode(text);
const chapterTitles = (project: Project) => project.chapters.slice(1).map((c) => c.title);
const sources = (project: Project) => project.chapters.slice(1).flatMap((c) => c.segments.map((s) => s.sourceText));
const allHtml = (project: Project) =>
  project.chapters
    .slice(1)
    .flatMap((c) => c.segments.map((s) => s.sourceHtml))
    .join('\n');

/** Inline Markdown rendered as XHTML markup. */
function inline(text: string): string {
  const doc = createXhtmlDocument(env, '');
  const p = doc.createElementNS(NS.XHTML, 'p');
  for (const node of renderInline(doc, text)) p.appendChild(node);
  return String(p).replace(/^<p[^>]*>|<\/p>$/g, '');
}

/**
 * The fastest of `runs` timed runs: other processes on a shared machine only ever slow a run down, while the quadratic
 * behaviour these tests guard against costs seconds on every run.
 */
const timed = async <T>(run: () => Promise<T> | T, runs = 3): Promise<{ value: T; ms: number }> => {
  let best: { value: T; ms: number } | undefined;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const value = await run();
    const ms = performance.now() - start;
    if (!best || ms < best.ms) best = { value, ms };
  }
  return best as { value: T; ms: number };
};

/**
 * Asserts that the work grows about linearly with the input: four times the input takes less than eight times as long
 * (linear work takes four times, quadratic sixteen), and even the largest input stays far below a generous cap. Times
 * are relative, so a slow or shared machine does not make the test flaky; times under 5 ms count as 5 ms, where timer
 * noise dominates.
 */
async function expectLinear(label: string, run: (scale: 1 | 4) => unknown): Promise<void> {
  const { ms: single } = await timed(() => run(1));
  const { ms: quadruple } = await timed(() => run(4));
  console.log(`${label}: ${single.toFixed(0)} ms, four times the input ${quadruple.toFixed(0)} ms`);
  expect(quadruple / Math.max(single, 5)).toBeLessThan(8);
  expect(quadruple).toBeLessThan(5000);
}

describe('Markdown front matter and scene breaks', () => {
  const scene =
    '---\n\nThe opening scene sets the stage for the whole story.\n\nAnother important paragraph follows here.\n\n---\n\nAfter the break the story continues for a while.\n';

  it('keeps a leading scene break and its text when the block is not YAML', async () => {
    const project = await importBook(encode(scene), 'story.md', env);
    expect(sources(project)).toEqual([
      'The opening scene sets the stage for the whole story.',
      'Another important paragraph follows here.',
      'After the break the story continues for a while.',
    ]);
    const chapter = unzipText(project.sourceEpub, 'OEBPS/text/chapter-001.xhtml');
    expect(chapter.match(/<hr\s*\/>/g)).toHaveLength(2);
  });

  it('keeps prose between two scene breaks even when the first line is not blank', () => {
    const lines = ['---', 'She opened the door.', 'Nobody was there: the hall was empty.', '---', 'Later.'];
    expect(splitFrontMatter(lines)).toEqual({ meta: {}, body: lines });
  });

  it('reads YAML front matter with lists, comments and quoted values, unescaping them', () => {
    const lines = [
      '---',
      'title: "Edge <Book> & \\"Co\\" \\u00e9"',
      "author: 'O''Brien'",
      'lang: en # the language',
      'tags:',
      '  - fiction',
      '  - classic',
      '---',
      'Body.',
    ];
    expect(splitFrontMatter(lines)).toEqual({ meta: { title: 'Edge <Book> & "Co" é', author: "O'Brien", lang: 'en' }, body: ['Body.'] });
  });

  it('puts the unescaped title in the package metadata', async () => {
    const project = await importBook(encode('---\ntitle: "A \\"Quoted\\" Title"\n---\n\nSome text.\n'), 'q.md', env);
    expect(project.title).toBe('A "Quoted" Title');
    expect(unzipText(project.sourceEpub, 'OEBPS/content.opf')).not.toContain('\\"');
  });

  it('never splits a chapter at an empty heading', async () => {
    const project = await importBook(encode('# Real One\n\nText one.\n\n#\n\nText two.\n\n# Real Two\n\nText three.\n'), 'e.md', env);
    expect(chapterTitles(project)).toEqual(['Real One', 'Real Two']);
    expect(sources(project)).toContain('Text two.');
  });
});

describe('Markdown without blank lines', () => {
  it('treats each line as a paragraph, like the plain-text importer, and converts in linear time', async () => {
    const flat = (lines: number) =>
      encode(`## Chapter 1\n${Array.from({ length: lines }, (_, i) => `Line ${i + 1} of the story goes on with a *few* more words in it.`).join('\n')}\n`);
    // The Markdown work (block and inline parsing, building the chapter) is timed; segmenting and zipping are shared with TXT.
    const inputs = { 1: flat(750), 4: flat(3000) };
    await expectLinear('single-newline Markdown lines', (scale) => markdownToEpub(inputs[scale], 'flat.md', env));
    const project = await importBook(inputs[4], 'flat.md', env);
    const chapter = project.chapters.find((c) => c.title === 'Chapter 1');
    expect(chapter?.segments).toHaveLength(3001);
    expect(chapter?.segments[1]?.sourceHtml).toBe('Line 1 of the story goes on with a <em>few</em> more words in it.');
  });

  it('imports a title and one hard-wrapped paragraph of 4000 and 16000 lines in linear time', async () => {
    // One blank line after the title makes every later line hard wrapping of one huge paragraph, cut after inline rendering.
    const book = (lines: number) =>
      encode(`# Title\n\n${Array.from({ length: lines }, (_, i) => `Line ${i + 1} of one long hard-wrapped paragraph goes on.`).join('\n')}\n`);
    const inputs = { 1: book(4000), 4: book(16_000) };
    await expectLinear('lines of one hard-wrapped Markdown paragraph imported', (scale) => importBook(inputs[scale], 'wrapped.md', env));
    const [title, ...parts] = sources(await importBook(inputs[4], 'wrapped.md', env));
    expect(title).toBe('Title');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toMatch(/^Line 1 of one long hard-wrapped paragraph goes on\. Line 2 /);
    expect(parts.join(' ')).toContain('Line 16000 of one long hard-wrapped paragraph goes on.');
    for (const part of parts) expect(estimateTokens(part)).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS);
  });

  it('turns a soft line break into one space and two trailing spaces into a hard break', () => {
    expect(inline('one \ntwo   \nthree\nfour')).toBe('one two<br />three four');
    expect(inline('*one*  \n  two')).toBe('<em>one</em><br />  two');
  });

  it('keeps hard-wrapped paragraphs whole when blank lines separate them', async () => {
    const project = await importBook(encode('First line\nsecond line.\n\nThird line\nfourth line.\n'), 'wrap.md', env);
    expect(sources(project)).toEqual(['First line second line.', 'Third line fourth line.']);
  });
});

describe('inline Markdown is linear and never recurses', () => {
  it.each(['*a ', '_a ', '~~a ', '[a](', '`` a ', '<!-- a '])('renders 30 and 120 KB of %j in linear time', async (unit) => {
    const texts = { 1: unit.repeat(Math.ceil(30_000 / unit.length)), 4: unit.repeat(Math.ceil(120_000 / unit.length)) };
    await expectLinear(`KB of ${JSON.stringify(unit)} rendered`, (scale) => inline(texts[scale]));
    expect(inline(texts[4]).length).toBeGreaterThan(0);
  });

  it('imports 30 and 120 KB of unmatched emphasis openers in linear time', async () => {
    const inputs = { 1: encode('*a '.repeat(10_000)), 4: encode('*a '.repeat(40_000)) };
    await expectLinear("KB '*a ' Markdown imported", (scale) => importBook(inputs[scale], 'stars.md', env));
    expect(sources(await importBook(inputs[4], 'stars.md', env)).join(' ')).toContain('*a *a');
  });

  it('survives deep nesting of quotes, brackets and emphasis', async () => {
    const quotes = await importBook(encode(`${'>'.repeat(50_000)} deep text\n`), 'deep.md', env);
    expect(sources(quotes)).toEqual(['deep text']);
    const chapter = unzipText(quotes.sourceEpub, 'OEBPS/text/chapter-001.xhtml');
    expect(chapter.match(/<blockquote/g)).toHaveLength(MAX_QUOTE_DEPTH);

    const nestedLines = Array.from({ length: 2000 }, (_, i) => `${'>'.repeat(i + 1)} level ${i + 1}`).join('\n');
    await expect(importBook(encode(nestedLines), 'stairs.md', env)).resolves.toBeDefined();
    expect(inline(`${'['.repeat(50_000)}x${'](u)'.repeat(50_000)}`)).toContain('x');
    expect(inline(`${'*_'.repeat(50_000)}x${'_*'.repeat(50_000)}`)).toContain('x');
    // Too long for one segment and nested far deeper than any book: split as raw text, still imported.
    const deepEmphasis = await importBook(encode(`${'*_'.repeat(5_000)}${'word '.repeat(2_000)}${'_*'.repeat(5_000)}\n`), 'deep-em.md', env);
    expect(sources(deepEmphasis).join(' ')).toContain('word word');
  });

  it('matches delimiters like before: emphasis, links, literal leftovers', () => {
    expect(inline('a *b **c** d* e')).toBe('a <em>b <strong>c</strong> d</em> e');
    expect(inline('***both***')).toBe('<strong><em>both</em></strong>');
    expect(inline('*a **b* c**')).toBe('<em>a **b</em> c**');
    expect(inline('snake_case_name and _em_')).toBe('snake_case_name and <em>em</em>');
    expect(inline('~~gone~~ and ~single~')).toBe('<s>gone</s> and ~single~');
    expect(inline('[a *b*](https://x.org/) [c](javascript:alert(1))')).toBe('<a href="https://x.org/">a <em>b</em></a> c');
    expect(inline('*a [b* c](https://x.org/)')).toBe('*a <a href="https://x.org/">b* c</a>');
    expect(inline('[[inner](https://a.org/)](https://b.org/)')).toBe('[<a href="https://a.org/">inner</a>](https://b.org/)');
    expect(inline('![alt *text*](pic.png) `*code*` 2 * 3 * 4')).toBe('alt <em>text</em> <code>*code*</code> 2 * 3 * 4');
    expect(inline('unclosed [link and *star')).toBe('unclosed [link and *star');
  });
});

describe('oversized paragraphs', () => {
  const sentence = 'This sentence is part of a very long paragraph that never seems to end. ';

  it('splits a paragraph longer than one segment may be at sentence ends', () => {
    const text = sentence.repeat(400).trim();
    const parts = splitLongText(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(estimateTokens(part)).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS);
      expect(part.endsWith('end.')).toBe(true);
    }
    expect(parts.join(' ')).toBe(text);
    expect(splitLongText('Short.')).toEqual(['Short.']);
  });

  it('splits text without sentence ends or spaces too, keeping surrogate pairs whole', () => {
    const cjk = '汉'.repeat(10_000);
    const emoji = '😀'.repeat(5_000);
    for (const text of [cjk, emoji, 'word '.repeat(5_000)]) {
      const parts = splitLongText(text);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) expect(estimateTokens(part)).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS);
      expect(parts.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    }
    for (const part of splitLongText(emoji)) expect(part).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
  });

  it('never imports a segment above the limit from TXT or Markdown', async () => {
    const giant = sentence.repeat(600);
    for (const [name, text] of [
      ['giant.txt', `Title\n\n${giant}\n\nThe end.`],
      ['giant.md', `# Title\n\n${giant}\n\nThe end.`],
      ['flat.md', `## One\n${giant}\nShort line.`],
      ['verse.txt', `Title\n\n${'A short verse line\n'.repeat(3000)}\nThe end.`],
    ] as const) {
      const project = await importBook(encode(text), name, env);
      const segments = project.chapters.flatMap((c) => c.segments);
      expect(Math.max(...segments.map((s) => estimateTokens(s.sourceHtml)))).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS + 50);
      const expected = name === 'verse.txt' ? 'A short verse line A short verse line' : sentence.repeat(3).trim();
      expect(sources(project).join(' ').replace(/\s+/g, ' ')).toContain(expected);
    }
  });

  it('keeps the HTML of split Markdown parts well formed', async () => {
    const project = await importBook(encode(`Intro.\n\n${'Some **bold** text here. '.repeat(500)}\n`), 'b.md', env);
    expect(allHtml(project)).not.toContain('**');
  });
});

describe('plain-text chapter headings', () => {
  const body = (n: number) => `This is the body of section ${n}. It has a couple of sentences.`;

  it('does not take sentences that start with a chapter keyword for headings', async () => {
    const text = [
      'My Story',
      'Part I think this is how it starts, honestly.',
      body(1),
      'Book did not arrive on time',
      body(2),
      'Part One of the plan failed',
      body(3),
    ].join('\n\n');
    const project = await importBook(encode(text), 'story.txt', env);
    expect(chapterTitles(project)).toEqual(['My Story']);
  });

  it('still finds real headings, including roman numerals, number words and prefaces', async () => {
    const text = ['My Story', 'Preface to the Second Edition', body(0), 'CHAPTER I.', body(1), 'Chapter Twenty-One', body(2), 'Part Two', body(3)].join('\n\n');
    const project = await importBook(encode(text), 'story.txt', env);
    expect(chapterTitles(project)).toEqual(['My Story', 'Preface to the Second Edition', 'CHAPTER I.', 'Chapter Twenty-One', 'Part Two']);
  });

  it('ignores page numbers that fall mid-sentence but keeps numbered chapters', async () => {
    const pages = [
      'The Scan',
      'It was a long way and he walked',
      '12',
      'into the room where they waited.',
      'Then he sat',
      '13',
      'down again.',
      'The end.',
    ].join('\n\n');
    expect(chapterTitles(await importBook(encode(pages), 'scan.txt', env))).toEqual(['The Scan']);

    const numbered = ['The Book', '1', body(1), '2', body(2), '3', body(3)].join('\n\n');
    expect(chapterTitles(await importBook(encode(numbered), 'book.txt', env))).toEqual(['The Book', '1', '2', '3']);
  });
});
