import { describe, expect, it } from 'vitest';
import { exportEpub, importBook, type Project, translateProject } from '../src';
import { validateTranslationMarkup } from '../src/translate/markup-validation';
import { readZip, writeEpubZip } from '../src/util/zip-archive';
import { answerAll, env, fakeTranslate, mockProvider, readFixture, unzipText } from './test-helpers';

const ACTIVE = /onerror|onload|onclick|javascript:|vbscript:|<script|srcdoc|data:text\/html/i;

describe('validateTranslationMarkup rejects injected active markup', () => {
  const src = 'Hello <b>world</b>';
  it.each([
    'Xin chào <b>thế giới</b> <img/src=x onerror=alert(1)>',
    'Xin chào <b>thế giới</b> <svg/onload=alert(1)>',
    'Xin chào <b/onclick=alert(1)>thế giới</b>',
    'Xin chào <b>thế giới</b><img\nsrc=x\nonerror=alert(1)>',
    'Xin chào <b>thế giới</b><IMG SRC=x ONERROR=alert(1)>',
    'Xin chào <b>thế giới</b><a href="javascript:alert(1)">x</a>',
    'Xin chào <b>thế giới</b><!-- <b title=" --><img src=x onerror=alert(1)>" -->',
    'Xin chào <b>thế giới</b><textarea><b title="</textarea><img src=x onerror=alert(1)>"></textarea>',
    'Xin chào <b>thế giới</b></ x><script>alert(1)</script>',
    'Xin chào <b>thế giới</b><img src=x onerror=alert(1)',
    'Xin chào <b title="x"onclick="alert(1)">thế giới</b>',
  ])('rejects %j', (translation) => {
    expect(validateTranslationMarkup(src, translation)).toBeDefined();
  });

  it('still accepts faithful translations, including attribute order and quoting changes', () => {
    const link = 'A <a href="x.html#n1" class="ref">note</a> &amp; <br/>end';
    expect(validateTranslationMarkup(link, "Một <a class=ref href='x.html#n1'>chú thích</a> &amp; <BR>hết")).toBeUndefined();
    expect(validateTranslationMarkup('a &lt; b', 'a < b và 3 <4')).toBeUndefined();
  });
});

/** Adds script vectors to the stored source package, as a hostile or careless source book would have them. */
function poisonSource(project: Project): void {
  const files = readZip(project.sourceEpub);
  const edit = (path: string, fn: (s: string) => string) => {
    const data = files.get(path);
    if (!data) throw new Error(`fixture changed: ${path}`);
    files.set(path, new TextEncoder().encode(fn(new TextDecoder().decode(data))));
  };
  const chapter = 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml';
  edit(chapter, (s) =>
    s.replace(
      '</body>',
      '<script>alert(1)</script><p onclick="alert(2)"><a href=" java&#x09;script:alert(3)">x</a><img src="a.png" alt="" onerror="alert(4)"/></p></body>',
    ),
  );
  edit('OEBPS/wrap0000.xhtml', (s) => s.replace('<svg ', '<svg onload="alert(5)" ').replace('</body>', '<script>alert(6)</script></body>'));
  edit('OEBPS/content.opf', (s) =>
    s.replace('id="item4" media-type="application/xhtml+xml"', 'id="item4" media-type="application/xhtml+xml" properties="scripted"'),
  );
  project.sourceEpub = writeEpubZip(files);
}

describe('export strips script vectors', () => {
  it('from model output and from the source book, in every content document', async () => {
    const project = await importBook(readFixture('a-modest-proposal.epub'), 'a.epub', env);
    poisonSource(project);
    const injected = ' <img/src=x onerror=alert(document.domain)><svg/onload=alert(1)><a href="javascript:alert(2)">j</a>';
    for (const s of project.chapters.flatMap((c) => c.segments)) {
      s.translationHtml = fakeTranslate(s.sourceHtml) + injected;
      s.status = 'translated';
    }
    const out = await exportEpub(project, 'bilingual', env);
    for (const [name, data] of readZip(out)) {
      if (!/\.(xhtml|html|svg)$/.test(name)) continue;
      expect(new TextDecoder().decode(data), name).not.toMatch(ACTIVE);
    }
    const chapter = unzipText(out, 'OEBPS/6893508861643006172_1080-h-1.htm.xhtml');
    expect(chapter).toContain('[vi] ');
    expect(chapter).toContain('src="a.png"');
    expect(unzipText(out, 'OEBPS/wrap0000.xhtml')).toContain('<svg');
    expect(unzipText(out, 'OEBPS/content.opf')).not.toContain('scripted');
  });

  it('keeps injected markup out of a translated book end to end', async () => {
    const project = await importBook(readFixture('a-modest-proposal.epub'), 'a.epub', env);
    const provider = mockProvider((req) => {
      const answer = JSON.parse(answerAll(req).text) as { segments: { id: string; html: string }[] };
      const segments = answer.segments.map((s) => ({ ...s, html: `${s.html} <img/src=x onerror=alert(document.domain)>` }));
      return { text: JSON.stringify({ segments }) };
    });
    await translateProject(project, provider, project.settings);
    expect(project.chapters.flatMap((c) => c.segments).every((s) => s.status === 'error')).toBe(true);
    const out = await exportEpub(project, 'bilingual', env);
    for (const [name, data] of readZip(out)) if (/\.xhtml$/.test(name)) expect(new TextDecoder().decode(data), name).not.toMatch(ACTIVE);
  });
});
