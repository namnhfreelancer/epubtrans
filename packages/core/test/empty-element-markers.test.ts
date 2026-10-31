import { describe, expect, it } from 'vitest';
import { type DetachedElement, detachEmptyElements, restoreDetachedElements } from '../src/translate/empty-element-markers';
import { validateTranslationMarkup } from '../src/translate/markup-validation';

const marker = (id: string, fraction: number): DetachedElement => ({ markup: `<a id="${id}"></a>`, name: 'a', fraction });

describe('detachEmptyElements', () => {
  it('removes empty page markers and records the share of text before them', () => {
    const { html, detached } = detachEmptyElements('Nor would <a id="p49"></a>people give.');
    expect(html).toBe('Nor would people give.');
    expect(detached).toEqual([{ markup: '<a id="p49"></a>', name: 'a', fraction: 10 / 22 }]);
  });

  it('detaches EPUB page-break spans, at start and end, in document order', () => {
    const source = '<span epub:type="pagebreak" id="p12" title="12"></span>Start &amp; end<a id="z"></a>';
    const { html, detached } = detachEmptyElements(source);
    expect(html).toBe('Start &amp; end');
    expect(detached.map((d) => [d.markup, d.name, d.fraction])).toEqual([
      ['<span epub:type="pagebreak" id="p12" title="12"></span>', 'span', 0],
      ['<a id="z"></a>', 'a', 1],
    ]);
  });

  it('keeps void elements, non-empty elements and elements holding only whitespace', () => {
    const source = 'A<br/>b <sup class="endnote"><a href="notes.htm#en4-11" id="nr4-11">11</a></sup> c<img src="x.png" alt=""/><i> </i>';
    expect(detachEmptyElements(source)).toEqual({ html: source, detached: [] });
  });

  it('detaches a wrapper holding only empty elements as one unit, and never restores it inside a link', () => {
    const source = 'Start <span class="pg"><a id="x"></a><a id="y"></a></span>middle <b>bold</b> end.';
    const { html, detached } = detachEmptyElements(source);
    expect(html).toBe('Start middle <b>bold</b> end.');
    expect(detached.map((d) => [d.markup, d.name])).toEqual([['<span class="pg"><a id="x"></a><a id="y"></a></span>', 'span']]);
    // Placed by the fraction alone it would fall inside the link; the inner <a> keeps it out.
    const translation = '<a href="#n">Bắt đầu giữa</a> <b>đậm</b> hết.';
    const restored = restoreDetachedElements(translation, detached);
    expect(restored).not.toMatch(/<a href="#n">[^<]*<span/);
    expect(restored).toContain('<span class="pg"><a id="x"></a><a id="y"></a></span>');
    // A link around a marker is not merged with it: the marker alone is detached, so it can be restored outside.
    expect(detachEmptyElements('A <a href="#n"><a id="p1"></a></a>b').detached.map((d) => d.markup)).toEqual(['<a id="p1"></a>']);
    // Wrappers around text or a void element stay in the protocol.
    for (const kept of ['<span><a id="x"></a>t</span>', '<span><a id="x"></a><br/></span>', '<span> <a id="x"></a></span>']) {
      expect(detachEmptyElements(kept).html).toContain('<span>');
    }
  });

  it('leaves markup it cannot fully see untouched', () => {
    for (const source of ['A <!-- x --><a id="p1"></a>b', 'A <a id="p1"></a>b <i', 'A <script></script>b']) {
      expect(detachEmptyElements(source).detached).toEqual([]);
    }
  });
});

describe('restoreDetachedElements', () => {
  it('puts a marker at the same text fraction, snapped to a word start', () => {
    // 22 characters; 0.5 → offset 11, nearest word start is "tiền" at 12.
    expect(restoreDetachedElements('Những người kiếm tiền.', [marker('p1', 0.5)])).toBe('Những người <a id="p1"></a>kiếm tiền.');
  });

  it('puts fraction 0 and 1 at the very start and end, outside surrounding elements', () => {
    const out = restoreDetachedElements('<b>Xin chào</b> thế <i>giới</i>', [marker('a', 0), marker('b', 1)]);
    expect(out).toBe('<a id="a"></a><b>Xin chào</b> thế <i>giới</i><a id="b"></a>');
  });

  it('keeps several markers in their original order, also when they share a position', () => {
    const out = restoreDetachedElements('one two three four', [marker('a', 0.3), marker('b', 0.3), marker('c', 0.7)]);
    expect(out).toBe('one <a id="a"></a><a id="b"></a>two three <a id="c"></a>four');
  });

  it('places markers between characters in text without spaces', () => {
    expect(restoreDetachedElements('你好世界', [marker('p1', 6 / 11)])).toBe('你好<a id="p1"></a>世界');
    expect(restoreDetachedElements('彼は、<b>こんにちは</b>と言った', [marker('p2', 0.5)])).toBe('彼は、<b>こんに<a id="p2"></a>ちは</b>と言った');
  });

  it('prefers the shallowest slot and never nests a marker in an element of the same name', () => {
    expect(restoreDetachedElements('foo <b>bar</b> baz', [marker('p1', 4 / 11)])).toBe('foo <a id="p1"></a><b>bar</b> baz');
    // Offset 8 is inside the link: the next word start outside it (offset 4) is used instead.
    expect(restoreDetachedElements('Một <a href="n.htm">chú thích</a> dài', [marker('p2', 8 / 17)])).toBe(
      'Một <a id="p2"></a><a href="n.htm">chú thích</a> dài',
    );
  });

  it('never splits an entity reference', () => {
    expect(restoreDetachedElements('&amp;&amp;&amp;&amp;', [marker('p', 0.5)])).toBe('&amp;&amp;<a id="p"></a>&amp;&amp;');
  });

  it('returns the HTML unchanged when nothing was detached', () => {
    expect(restoreDetachedElements('Xin <b>chào</b>', [])).toBe('Xin <b>chào</b>');
  });

  it('round-trips into markup that validates against the original source', () => {
    const source = 'Nor would <a id="p49"></a>people <sup class="endnote"><a href="notes.htm#en4-11" id="nr4-11">11</a></sup> give<a id="p50"></a>.';
    const { html, detached } = detachEmptyElements(source);
    const translation = 'Người <sup class="endnote"><a href="notes.htm#en4-11" id="nr4-11">11</a></sup> kiếm tiền để cho đi cũng không sai.';
    expect(validateTranslationMarkup(html, translation)).toBeUndefined();
    const restored = restoreDetachedElements(translation, detached);
    expect(validateTranslationMarkup(source, restored)).toBeUndefined();
    expect(restored.indexOf('id="p49"')).toBeLessThan(restored.indexOf('id="p50"'));
    expect(restored).not.toMatch(/<a href[^>]*>[^<]*<a id/);
  });
});
