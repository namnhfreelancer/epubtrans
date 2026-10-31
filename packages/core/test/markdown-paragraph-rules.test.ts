import { describe, expect, it } from 'vitest';
import { importBook } from '../src';
import { splitFrontMatter } from '../src/formats/markdown-front-matter';
import { MAX_SEGMENT_TOKENS } from '../src/formats/split-long-text';
import { estimateTokens } from '../src/translate/token-estimate';
import { env } from './test-helpers';

type Project = Awaited<ReturnType<typeof importBook>>;
const encode = (text: string) => new TextEncoder().encode(text);
const segments = (project: Project) => project.chapters.slice(1).flatMap((c) => c.segments);
const chapterTitles = (project: Project) => project.chapters.slice(1).map((c) => c.title);

/** A paragraph hard-wrapped into `lines` lines of about 60 columns, the way Pandoc or an editor wraps Markdown. */
function wrappedParagraph(n: number, lines: number): string {
  return Array.from({ length: lines }, (_, i) => `paragraph ${n} line ${i + 1} of the argument proceeds from the conditions`).join('\n');
}

describe('Markdown paragraphs and hard wrapping', () => {
  it.each([19, 21, 25])('keeps 40 paragraphs of %i wrapped lines as 40 paragraphs', async (lines) => {
    const body = Array.from({ length: 40 }, (_, i) => wrappedParagraph(i + 1, lines)).join('\n\n');
    const project = await importBook(encode(`# Essay\n\n## One\n\n${body}\n`), 'essay.md', env);
    const paragraphs = segments(project).filter((s) => s.sourceText.startsWith('paragraph'));
    expect(paragraphs).toHaveLength(40);
    expect(paragraphs[0]?.sourceText).toContain('paragraph 1 line 1 of the argument');
    expect(paragraphs[0]?.sourceText).toContain(`paragraph 1 line ${lines} of the argument`);
  });

  it('puts one paragraph on each line only when the file has no blank line at all', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} is a paragraph of its own.`);
    const flat = await importBook(encode(`## One\n${lines.join('\n')}\n`), 'flat.md', env);
    expect(segments(flat).filter((s) => s.sourceText.startsWith('Line'))).toHaveLength(30);

    // One blank line anywhere: lines are hard wrapping, as in the plain-text importer.
    const mostlyFlat = await importBook(encode(`## One\n\n${lines.join('\n')}\n`), 'mostly-flat.md', env);
    expect(segments(mostlyFlat).filter((s) => s.sourceText.startsWith('Line'))).toHaveLength(1);
    const txt = await importBook(encode(`One\n\n${lines.join('\n')}\n`), 'mostly-flat.txt', env);
    expect(segments(txt).filter((s) => s.sourceText.startsWith('Line'))).toHaveLength(1);
  });

  it('ignores blank lines inside fenced code and at the start or end of the file', async () => {
    const text = '\n\n## One\nFirst line.\n```\ncode\n\nmore code\n```\nSecond line.\nThird line.\n\n\n';
    const project = await importBook(encode(text), 'fenced.md', env);
    expect(segments(project).map((s) => s.sourceText)).toEqual(expect.arrayContaining(['First line.', 'Second line.', 'Third line.']));
  });
});

describe('setext headings in a file without blank lines', () => {
  it('reads `===` and `---` underlines as headings', async () => {
    const body = Array.from({ length: 50 }, (_, i) => `Line ${i + 1} of the story.`).join('\n');
    const project = await importBook(encode(`The Title\n=========\nPart One\n--------\n${body}\n`), 'setext.md', env);
    expect(project.title).toBe('The Title');
    // The title heading opens the front matter chapter (labelled with the book title), "Part One" a chapter of its own.
    expect(chapterTitles(project)).toEqual(['The Title', 'Part One']);
    const chapter = project.chapters.find((c) => c.title === 'Part One');
    expect(chapter?.segments[0]?.sourceText).toBe('Part One');
    expect(
      segments(project)
        .map((s) => s.sourceText)
        .join('\n'),
    ).not.toMatch(/===|---/);
  });

  it('keeps a `---` under a sentence as a scene break', async () => {
    const project = await importBook(encode('He left the house.\n---\nShe stayed behind.\nThe end.\n'), 'scene.md', env);
    expect(segments(project).map((s) => s.sourceText)).toEqual(['He left the house.', 'She stayed behind.', 'The end.']);
  });
});

describe('Markdown front matter keys', () => {
  it('does not take a play opening with script lines between `---` lines for front matter', async () => {
    const lines = ['---', 'HAMLET: To be, or not to be, that is the question.', 'Ophelia: Good my lord, how does your honour?', '---', 'Exit.'];
    expect(splitFrontMatter(lines)).toEqual({ meta: {}, body: lines });
    const project = await importBook(encode(`${lines.join('\n')}\n`), 'play.md', env);
    expect(
      segments(project)
        .map((s) => s.sourceText)
        .join('\n'),
    ).toContain('HAMLET: To be, or not to be');
  });

  it('accepts capitalized keys such as `Cover-Image` next to a well-known key', async () => {
    expect(splitFrontMatter(['---', 'title: X', 'Cover-Image: a.png', 'Layout: book', '---', 'Body.'])).toEqual({ meta: { title: 'X' }, body: ['Body.'] });
    const project = await importBook(encode('---\ntitle: X\nCover-Image: a.png\n---\n\nBody text.\n'), 'cover.md', env);
    expect(project.title).toBe('X');
    expect(segments(project).map((s) => s.sourceText)).toEqual(['Body text.']);
  });

  it('keeps a block without any well-known key, or with an all-caps key, as content', () => {
    for (const block of [
      ['Hamlet: To be, or not to be.', 'Ophelia: Good my lord.'],
      ['title: Interview', 'Q: Where were you?', 'A: At home.'],
      ['layout: post', 'permalink: /x'],
    ]) {
      const lines = ['---', ...block, '---', 'Exit.'];
      expect(splitFrontMatter(lines)).toEqual({ meta: {}, body: lines });
    }
  });

  it('still reads lower-case keys and capitalized well-known keys', () => {
    expect(splitFrontMatter(['---', 'Title: Book', 'Author: Someone', 'cover-image: c.jpg', 'date_published: 2020', '---', 'Text.'])).toEqual({
      meta: { title: 'Book', author: 'Someone' },
      body: ['Text.'],
    });
  });
});

describe('splitting long Markdown paragraphs', () => {
  const sentence = 'This sentence belongs to a very long paragraph that goes on. ';

  it('closes and reopens emphasis at the cuts, so no delimiter becomes literal text', async () => {
    const project = await importBook(encode(`Intro.\n\n*${sentence.repeat(1500).trim()}*\n\nThe end.\n`), 'em.md', env);
    const parts = segments(project).filter((s) => s.sourceText.startsWith('This sentence'));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.sourceHtml).toMatch(/^<em>This sentence[^<]*goes on\.<\/em>$/);
      expect(estimateTokens(part.sourceHtml)).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS + 50);
    }
    expect(parts.map((p) => p.sourceText).join(' ')).toBe(sentence.repeat(1500).trim());
  });

  it('keeps the link target on both sides of a cut inside a link, and cuts at sentence ends', async () => {
    const text = `Before. [${sentence.repeat(400).trim()}](https://example.org/) After **bold** text.`;
    const project = await importBook(encode(`${text}\n`), 'link.md', env);
    const html = segments(project).map((s) => s.sourceHtml);
    expect(html.length).toBeGreaterThan(1);
    expect(html.filter((h) => h.includes('<a href="https://example.org/">')).length).toBe(html.length);
    expect(html.join('\n')).not.toMatch(/[*[\]]/);
    expect(html.at(-1)).toContain('<strong>bold</strong> text.');
    for (const h of html.slice(0, -1)) expect(h).toMatch(/goes on\.<\/a>$/);
  });
});
