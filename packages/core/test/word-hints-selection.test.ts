import { describe, expect, it } from 'vitest';
import { hintContext, hintRankThreshold, lemmatizeEnglish, parseFrequencyList, selectHintCandidates, UNLISTED_RANK, wordHintLanguage } from '../src';
import { hintTextChunks } from '../src/word-hints/hint-text';
import { makeProject, rankedList, readFrequencyList, segment } from './test-helpers';

const en = readFrequencyList('en');
const lemmas = (project: ReturnType<typeof makeProject>, list = en, level = 3, glossary = project.settings.glossary) =>
  selectHintCandidates(project, list, { level, glossary }).map((c) => c.lemma);

describe('lemmatizeEnglish', () => {
  const cases: [string, string][] = [
    ['obfuscated', 'obfuscate'],
    ['obfuscates', 'obfuscate'],
    ['obfuscating', 'obfuscate'],
    ['abacuses', 'abacus'],
    ['studies', 'study'],
    ['cried', 'cry'],
    ['happier', 'happy'],
    ['wolves', 'wolf'],
    ['knives', 'knife'],
    ['boxes', 'box'],
    ['watches', 'watch'],
    ['hates', 'hate'],
    ['hated', 'hate'],
    ['hoped', 'hope'],
    ['hopped', 'hop'],
    ['stopped', 'stop'],
    ['running', 'run'],
    ['visited', 'visit'],
    ['opened', 'open'],
    ['agreed', 'agree'],
    ['dying', 'die'],
    ['smote', 'smite'],
    ['trod', 'tread'],
    ['forsook', 'forsake'],
    ['children', 'child'],
    ['went', 'go'],
    // Words that only look inflected keep their own form.
    ['news', 'news'],
    ['ceiling', 'ceiling'],
    ['seed', 'seed'],
    ['united', 'united'],
    ['bitter', 'bitter'],
    ['forest', 'forest'],
    ['during', 'during'],
    ['physics', 'physics'],
    ['sanguine', 'sanguine'],
  ];
  for (const [word, lemma] of cases) it(`${word} → ${lemma}`, () => expect(lemmatizeEnglish(word, en.rank)).toBe(lemma));

  it('lowercases and keeps unknown words as they are', () => {
    expect(lemmatizeEnglish('Obfuscated', en.rank)).toBe('obfuscate');
    expect(lemmatizeEnglish('zzyzxes', en.rank)).toBe('zzyzxes');
  });
});

describe('frequency lists', () => {
  it('maps language tags to supported lists and rejects unsupported ones', () => {
    expect(wordHintLanguage('en-GB')).toBe('en');
    expect(wordHintLanguage('pt-BR')).toBe('pt');
    expect(wordHintLanguage('zh')).toBe('zh');
    expect(wordHintLanguage('zh-Hans-CN')).toBe('zh');
    expect(wordHintLanguage('zh-Hant')).toBeUndefined();
    expect(wordHintLanguage('zh-TW')).toBeUndefined();
    expect(wordHintLanguage('vi')).toBeUndefined();
    expect(wordHintLanguage('auto')).toBeUndefined();
    expect(wordHintLanguage('not a tag')).toBeUndefined();
  });

  it('parses ranks from line order and rejects something that is not a list', () => {
    const list = rankedList('en', { alpha: 1, beta: 150 });
    expect(list.rank('alpha')).toBe(1);
    expect(list.rank('beta')).toBe(150);
    expect(list.rank('gamma')).toBeUndefined();
    expect(() => parseFrequencyList('en', '<!doctype html><html>not found</html>')).toThrow(/not a word list/);
    expect(() => parseFrequencyList('en', '# header\nthe\nof\n')).toThrow(/empty or truncated/);
  });

  it('ships every supported language with a usable list (CJK included)', () => {
    for (const lang of ['fr', 'de', 'es', 'it', 'pt', 'ru', 'nl', 'pl', 'ja', 'zh', 'ko'] as const) {
      const list = readFrequencyList(lang);
      expect(list.size, lang).toBeGreaterThan(20_000);
    }
    expect(en.size).toBeGreaterThanOrEqual(100_000);
    expect(en.rank('the')).toBe(1);
  });
});

describe('selectHintCandidates', () => {
  const list = rankedList('en', { a: 1, and: 2, word: 3, common: 50, ordinary: 4000, uncommon: 12_000, rare: 20_000, rarest: 30_000 });

  it('selects words by level: higher levels add more frequent words', () => {
    const project = makeProject([[segment('c1-0', '<p>A common, ordinary, uncommon, rare and rarest word.</p>')]]);
    expect(lemmas(project, list, 1)).toEqual(['rarest']);
    expect(lemmas(project, list, 2)).toEqual(['rare', 'rarest']);
    expect(lemmas(project, list, 3)).toEqual(['uncommon', 'rare', 'rarest']);
    expect(lemmas(project, list, 5)).toEqual(['ordinary', 'uncommon', 'rare', 'rarest']);
    expect(hintRankThreshold(3)).toBeLessThan(hintRankThreshold(2));
  });

  it('groups inflected forms under one lemma with every occurrence, counting repeats of a word per segment', () => {
    const project = makeProject([
      [segment('c0-0', 'They obfuscated it, and obfuscated it again.'), segment('c0-1', 'She obfuscates.')],
      [segment('c1-0', 'Obfuscating everything.')],
    ]);
    const [candidate] = selectHintCandidates(project, en, { level: 3 });
    expect(candidate?.lemma).toBe('obfuscate');
    expect(candidate?.occurrences.map((o) => [o.segmentId, o.word, o.nth, o.chapter])).toEqual([
      ['c0-0', 'obfuscated', 0, 0],
      ['c0-0', 'obfuscated', 1, 0],
      ['c0-1', 'obfuscates', 0, 0],
      ['c1-0', 'Obfuscating', 0, 1],
    ]);
  });

  it('skips proper nouns: mid-sentence capitals, names used at a sentence start, and glossary names', () => {
    const glossary = [
      { term: 'Lord Quimby', translation: 'Quimby', type: 'person' as const },
      { term: 'Sanguine Hills', translation: 'Đồi Sanguine', type: 'place' as const },
    ];
    const project = makeProject([
      [
        segment('c1-0', 'Yesterday Obadiah met Lord Quimby near the Sanguine Hills.'),
        segment('c1-1', 'Obadiah was perspicacious. Truculent men are rare.'),
        segment('c1-2', 'He grew truculent, but stayed perspicacious.'),
      ],
    ]);
    project.settings.glossary = glossary;
    const found = lemmas(project);
    expect(found).not.toContain('obadiah');
    expect(found).not.toContain('quimby');
    expect(found).not.toContain('sanguine');
    expect(found).toContain('perspicacious');
    // "Truculent" at a sentence start is an ordinary word: the book also writes it in lowercase.
    expect(found).toContain('truculent');
  });

  it('skips numbers, short words, common words and text in code, sub/sup and note references', () => {
    const project = makeProject([
      [
        segment(
          'c1-0',
          '<p>In 1729 the <code>obfuscated</code> value<sup>perspicacious</sup> and <a epub:type="noteref" href="#n1">truculent</a> ox ran 42nd.</p>',
        ),
      ],
    ]);
    expect(lemmas(project, en, 5)).toEqual([]);
  });

  it('treats unlisted lowercase words as rare, but not unlisted capitalized or short ones', () => {
    const project = makeProject([[segment('c1-0', 'A publick cabbin, said Zorblax. Qrx.')]]);
    const found = selectHintCandidates(project, en, { level: 3 });
    expect(found.map((c) => c.lemma)).toEqual(['publick', 'cabbin']);
    expect(en.rank('cabbin')).toBeUndefined();
    expect(found[1]?.rank).toBe(UNLISTED_RANK);
  });

  it('lemmatizes unlisted English words against the words of the book', () => {
    const project = makeProject([[segment('c1-0', 'One metacharity, two metacharities, and frobnicated frobnicates.')]]);
    expect(lemmas(project)).toEqual(['metacharity', 'frobnicated', 'frobnicates']);
  });

  it('keeps capitalized nouns in German, where a capital letter is no name signal', () => {
    const de = rankedList('de', { die: 1, unverfrorenheit: 20_000, gemeinheit: 18_000 });
    const project = makeProject([[segment('c1-0', 'Die Unverfrorenheit und die Gemeinheit.')]]);
    project.settings.sourceLang = 'de';
    expect(lemmas(project, de, 3)).toEqual(['unverfrorenheit', 'gemeinheit']);
  });

  it('segments Chinese text into words and skips words missing from the list', () => {
    const zh = readFrequencyList('zh');
    const project = makeProject([[segment('c1-0', '他在图书馆里研究古代天文学和占星术。')]]);
    project.settings.sourceLang = 'zh';
    const found = lemmas(project, zh, 3);
    expect(found).toContain('天文学');
    for (const lemma of found) expect(zh.rank(lemma) ?? 0).toBeGreaterThan(hintRankThreshold(3));
  });

  it('never hints the table of contents', () => {
    const project = makeProject([[segment('c0-0', 'Perspicacious chapter')], [segment('c1-0', 'A perspicacious remark.')]]);
    const [toc] = project.chapters;
    if (toc) toc.title = 'Table of Contents';
    expect(selectHintCandidates(project, en, { level: 3 })[0]?.occurrences.map((o) => o.segmentId)).toEqual(['c1-0']);
  });
});

describe('hint text and contexts', () => {
  it('reads eligible text chunks from serialized markup', () => {
    expect(hintTextChunks('<p>A &amp; B<br/>C <code>x()</code> D<sup>1</sup>.</p>')).toEqual(['A & B', ' ', 'C ', ' ', ' D', ' ', '.']);
  });

  it('marks the word in its sentence and cuts long sentences', () => {
    const text = 'First sentence here. The river banks were muddy. Last one.';
    expect(hintContext({ text, start: text.indexOf('banks'), word: 'banks' })).toBe('The river ⟦banks⟧ were muddy.');
    const long = `${'word '.repeat(200)}target ${'word '.repeat(200)}`;
    const context = hintContext({ text: long, start: long.indexOf('target'), word: 'target' });
    expect(context).toContain('⟦target⟧');
    expect(context.length).toBeLessThan(300);
  });
});
