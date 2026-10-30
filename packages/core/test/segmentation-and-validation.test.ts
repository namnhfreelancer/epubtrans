import { describe, expect, it } from 'vitest';
import { generateGuide } from '../src';
import { parseXhtmlDocument } from '../src/dom/xhtml-document';
import { segmentContentDocument } from '../src/segment/segment-document';
import { validateTranslationMarkup } from '../src/translate/markup-validation';
import { parseSegmentsAnswer } from '../src/translate/prompt-protocol';
import { env, makeProject, mockProvider, segment } from './test-helpers';

const DOC = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body>
<h1>Chapter <em>One</em></h1>
<p>Use the <code>map()</code> function.</p>
<pre><code>const x = 1;</code></pre>
<p><code>npm install</code></p>
<figure><pre>ascii art</pre><figcaption>Code sample</figcaption></figure>
<figure><img src="a.png" alt=""/><figcaption>A real caption</figcaption></figure>
<div><p>Nested paragraph.</p><ul><li>Item <b>one</b></li><li>42</li></ul></div>
<svg xmlns="http://www.w3.org/2000/svg"><text>vector text</text></svg>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>
<p>* * *</p>
<table><tr><td>Cell text</td></tr></table>
</body></html>`;

describe('segmentContentDocument', () => {
  it('segments prose blocks and skips code, math, svg and non-text', () => {
    const doc = parseXhtmlDocument(env, DOC);
    const segments = segmentContentDocument(doc, 'c1-');
    expect(segments.map((s) => s.sourceText)).toEqual([
      'Chapter One',
      'Use the map() function.',
      'A real caption',
      'Nested paragraph.',
      'Item one',
      'Cell text',
    ]);
    expect(segments[0]?.sourceHtml).toBe('Chapter <em>One</em>');
    expect(segments.map((s) => s.id)).toEqual(['c1-0', 'c1-1', 'c1-2', 'c1-3', 'c1-4', 'c1-5']);
  });

  it('parses HTML-flavoured markup with named entities', () => {
    const doc = parseXhtmlDocument(env, '<html><body><p>Caf&eacute;&nbsp;au lait &mdash; yes<br>no</p></body></html>');
    const [s] = segmentContentDocument(doc, 'x-');
    expect(s?.sourceText).toBe('Café au lait — yes no');
    expect(s?.sourceHtml).toContain('<br/>');
  });
});

describe('validateTranslationMarkup', () => {
  const src = 'A <a href="x.html#n1" class="ref">note</a> and <b>bold</b><br/>end';
  it('accepts reordered tags with identical attributes', () => {
    expect(validateTranslationMarkup(src, '<b>Đậm</b> và <a class="ref" href="x.html#n1">chú thích</a><br>hết')).toBeUndefined();
  });
  it('rejects dropped, added or altered tags', () => {
    expect(validateTranslationMarkup(src, 'Đậm và chú thích<br/>hết')).toMatch(/tags/);
    expect(validateTranslationMarkup(src, '<b>Đậm</b> <a href="javascript:alert(1)" class="ref">x</a><br/>')).toMatch(/attributes/);
    expect(validateTranslationMarkup(src, '<b>Đậm <a href="x.html#n1" class="ref">x</a><br/>')).toMatch(/unbalanced/);
    expect(validateTranslationMarkup('Hi', '<script>x</script>Hi')).toBeDefined();
    expect(validateTranslationMarkup('Hi', '  ')).toBe('empty translation');
  });
});

describe('protocol parsing', () => {
  it('tolerates fences and prose around the JSON answer', () => {
    const answer = parseSegmentsAnswer('Here you go:\n```json\n{"segments":[{"id":"a","html":" Xin chào "},{"id":"b"}]}\n```');
    expect([...answer]).toEqual([['a', 'Xin chào']]);
    expect(() => parseSegmentsAnswer('no json here')).toThrow(/no JSON/);
  });

  it('generates a guideline and a cleaned glossary', async () => {
    const project = makeProject([[segment('a', 'The fox met the lion.')]]);
    const provider = mockProvider(() => ({
      text: '{"guideline":"- Warm tone","glossary":[{"term":"fox","translation":"cáo"},{"term":"Fox","translation":"dup"},{"term":"","translation":"x"},{"term":"lion","translation":"sư tử","note":"animal"}]}',
    }));
    const guide = await generateGuide(project, provider, project.settings);
    expect(guide).toEqual({
      guideline: '- Warm tone',
      glossary: [
        { term: 'fox', translation: 'cáo' },
        { term: 'lion', translation: 'sư tử', note: 'animal' },
      ],
    });
    expect(provider.calls[0]?.user).toContain('The fox met the lion.');
  });
});
