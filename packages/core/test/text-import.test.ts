import { describe, expect, it } from 'vitest';
import { detectFormat, EXPORT_MODES, exportEpub, importBook, translateProject } from '../src';
import { readZip } from '../src/util/zip-archive';
import { answerAll, env, mockProvider, readFixture, unzipText } from './test-helpers';

const encode = (text: string) => new TextEncoder().encode(text);
const chapterTitles = (project: Awaited<ReturnType<typeof importBook>>) => project.chapters.slice(1).map((c) => c.title);
const allSource = (project: Awaited<ReturnType<typeof importBook>>) =>
  project.chapters
    .slice(1)
    .flatMap((c) => c.segments.map((s) => s.sourceHtml))
    .join('\n');

describe('plain text import', () => {
  it('detects .txt by extension and refuses binary content', () => {
    expect(detectFormat(encode('Hello there, reader.'), 'book.TXT').format).toBe('txt');
    expect(() => detectFormat(new Uint8Array([0x41, 0x00, 0x42, 0x43, 0x44]), 'book.txt')).toThrow(/not a text file/);
  });

  it('splits chapters on "CHAPTER N." lines, joins wrapped lines and takes the title from the first line', async () => {
    const project = await importBook(readFixture('aesop-fables.txt'), 'aesop-fables.txt', env);
    expect(project.title).toBe('Three Fables of Aesop');
    expect(chapterTitles(project)).toEqual([
      'Three Fables of Aesop',
      'CHAPTER I. The Fox and the Grapes',
      'CHAPTER II. The Wolf and the Lamb',
      'CHAPTER III. The Tortoise and the Hare',
    ]);
    const fox = project.chapters[2]?.segments ?? [];
    expect(fox[0]?.sourceHtml).toBe('CHAPTER I.<br/>The Fox and the Grapes');
    expect(fox[1]?.sourceText).toMatch(/^A famished Fox saw some clusters of ripe black grapes hanging from a trellised vine\. She/);
    const opf = unzipText(project.sourceEpub, 'OEBPS/content.opf');
    expect(opf).toContain('<dc:language>en</dc:language>');
  });

  it('falls back to spaced title lines, then to numbered chunks, and keeps markup out of the text', async () => {
    const spaced = await importBook(
      encode('Intro text here.\n\n\nThe Beginning\n\nOnce upon a time.\n\n\nThe End\n\nThey lived <b>happily</b>.\n'),
      'tale.txt',
      env,
    );
    expect(chapterTitles(spaced)).toEqual(['tale', 'The Beginning', 'The End']);
    expect(allSource(spaced)).toContain('They lived &lt;b&gt;happily&lt;/b&gt;.');

    const long = Array.from({ length: 90 }, (_, i) => `Paragraph number ${i + 1} of a text without headings.`).join('\n\n');
    const chunked = await importBook(encode(long), 'my_long_text.txt', env);
    expect(chunked.title).toBe('my long text');
    expect(chapterTitles(chunked)).toEqual(['1', '2', '3']);
  });

  it('keeps short verse lines apart and decodes Windows-1252 files', async () => {
    const verse = await importBook(encode('Roses are red,\nviolets are blue,\nsugar is sweet.\n\nThe end of it all.'), 'poem.txt', env);
    expect(allSource(verse)).toContain('Roses are red,<br/>violets are blue,<br/>sugar is sweet.');
    const cp1252 = new Uint8Array([...encode('Caf'), 0xe9, ...encode(' au lait, ten '), 0x80, ...encode(' a cup.')]);
    const project = await importBook(cp1252, 'cafe.txt', env);
    expect(allSource(project)).toContain('Café au lait, ten € a cup.');
  });
});

describe('Markdown import', () => {
  it('splits on level-2 headings under a single title heading and renders emphasis, links, lists and code', async () => {
    const project = await importBook(readFixture('aesop-fables.md'), 'aesop-fables.md', env);
    expect(detectFormat(readFixture('aesop-fables.md'), 'x.markdown').format).toBe('md');
    expect(project.title).toBe('Three Fables of Aesop');
    expect(project.author).toBe('Aesop');
    expect(chapterTitles(project)).toEqual(['Three Fables of Aesop', 'The Fox and the Grapes', 'The Wolf and the Lamb', 'The Tortoise and the Hare']);
    const html = allSource(project);
    expect(html).toContain('<em>George Fyler Townsend</em>');
    expect(html).toContain('<a href="https://www.gutenberg.org/ebooks/21">Project Gutenberg</a>');
    expect(html).toContain('A <strong>famished</strong> Fox');
    expect(html).toContain('<em>wearied herself in vain</em>');
    expect(html).toContain('<s>slowly</s>');
    expect(html).toContain('<strong><em>Slow but steady wins the race.</em></strong>');
    expect(html).toContain('A dangerous link keeps only its text.');
    expect(html).not.toMatch(/javascript:|<script|alert\(/);
    // Fenced code is kept but never translated (no segment holds it).
    const files = readZip(project.sourceEpub);
    const tortoise = new TextDecoder().decode(files.get('OEBPS/text/chapter-004.xhtml'));
    expect(tortoise).toContain('<pre><code>moral = "Slow but steady wins the race."</code></pre>');
    expect(tortoise).toMatch(/<ol[^>]*><li[^>]*>The two started together.<\/li>/);
    expect(html).not.toContain('moral =');
  });

  it('splits on level-1 headings when there are several and uses the file name as title', async () => {
    const md = '# One\n\nFirst *chapter* text.\n\n# Two\n\nSecond chapter with `code` and a hard  \nbreak.\n\nSetext\n======\n\nThird.';
    const project = await importBook(encode(md), 'notes/my_book.md', env);
    expect(project.title).toBe('my book');
    expect(chapterTitles(project)).toEqual(['One', 'Two', 'Setext']);
    expect(allSource(project)).toContain('Second chapter with <code>code</code> and a hard<br/>break.');
  });
});

describe('exports of converted books', () => {
  it('exports TXT and Markdown books in every mode with the translations in place', async () => {
    for (const name of ['aesop-fables.txt', 'aesop-fables.md']) {
      const project = await importBook(readFixture(name), name, env);
      await translateProject(project, mockProvider(answerAll), { ...project.settings, model: 'm', sourceLang: 'en', targetLang: 'vi' });
      for (const mode of EXPORT_MODES) {
        const files = readZip(await exportEpub(project, mode, env));
        const chapter = new TextDecoder().decode(files.get('OEBPS/text/chapter-002.xhtml'));
        expect(chapter).toContain('[vi]');
      }
    }
  });
});
