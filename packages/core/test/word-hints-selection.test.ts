import { describe, expect, it } from 'vitest';
import { hintContext, hintRankThreshold, lemmatizeEnglish, parseFrequencyList, selectHintCandidates, UNLISTED_RANK, wordHintLanguage } from '../src';
import { cleanGloss } from '../src/word-hints/gloss-protocol';
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
    // The plain -s reading wins over -ves → f/fe and sibilant -es, and over corpus junk ("graf", "sens", "quot").
    ['graves', 'grave'],
    ['caves', 'cave'],
    ['senses', 'sense'],
    ['roses', 'rose'],
    ['clauses', 'clause'],
    ['universes', 'universe'],
    ['proves', 'prove'],
    ['motives', 'motive'],
    ['believes', 'believe'],
    ['saves', 'save'],
    // … unless the other reading is listed and far more frequent.
    ['potatoes', 'potato'],
    ['halves', 'half'],
    ['heroes', 'hero'],
    ['glasses', 'glass'],
    // The silent-e form wins when it is far more frequent than the bare stem.
    ['quoting', 'quote'],
    ['based', 'base'],
    ['caused', 'cause'],
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

  it('segments Chinese text into words; unlisted words of 2+ Han characters count as rare', () => {
    const zh = readFrequencyList('zh');
    const project = makeProject([[segment('c1-0', '他在图书馆里研究古代天文学和占星术。他踌躇不前，惆怅万分，饕餮之徒，岁月蹉跎。')]]);
    project.settings.sourceLang = 'zh';
    const found = lemmas(project, zh, 3);
    expect(found).toContain('天文学');
    for (const word of ['踌躇', '惆怅', '饕餮', '蹉跎']) {
      expect(zh.rank(word), word).toBeUndefined();
      expect(lemmas(project, zh, 1), word).toContain(word);
    }
    for (const lemma of found) expect(zh.rank(lemma) ?? UNLISTED_RANK).toBeGreaterThan(hintRankThreshold(3));
  });

  it('hints unlisted Japanese kanji words even at levels 1–2, but no unlisted single characters, kana or Korean word forms', () => {
    const ja = readFrequencyList('ja');
    const project = makeProject([[segment('c1-0', '彼は躊躇し、逡巡したあと韜晦して、顰蹙を買った。矜持を忖度し、慟哭のあと邂逅した。')]]);
    project.settings.sourceLang = 'ja';
    const hard = ['逡巡', '韜晦', '顰蹙', '矜持', '慟哭'];
    for (const level of [1, 2]) {
      const found = lemmas(project, ja, level);
      for (const word of hard) expect(found, `${word} at level ${level}`).toContain(word);
      for (const lemma of found) expect([...lemma].length > 1 || (ja.rank(lemma) ?? 0) > hintRankThreshold(level), lemma).toBe(true);
    }
    for (const word of hard) expect(ja.rank(word)).toBeUndefined();

    // Korean words carry their particles ("사람들은"), so unlisted forms are ordinary words, not rare ones.
    const ko = readFrequencyList('ko');
    const korean = makeProject([[segment('c1-0', '그는 망설이다가 결국 사람들은 집으로 돌아갔다.')]]);
    korean.settings.sourceLang = 'ko';
    expect(lemmas(korean, ko, 1)).toEqual([]);
  });

  it('never hints back matter such as the index, notes or bibliography', () => {
    const project = makeProject([
      [segment('c0-0', 'A perspicacious man.')],
      [segment('c1-0', 'Perspicacious men, 12')],
      [segment('c2-0', 'A truculent note.')],
    ]);
    const titles = ['Chapter One', 'Index', 'Notes'];
    project.chapters.forEach((c, i) => {
      c.title = titles[i] as string;
    });
    const found = selectHintCandidates(project, en, { level: 3 });
    expect(found.map((c) => c.lemma)).toEqual(['perspicacious']);
    expect(found[0]?.occurrences.map((o) => o.segmentId)).toEqual(['c0-0']);
  });

  it('never hints the table of contents', () => {
    const project = makeProject([[segment('c0-0', 'Perspicacious chapter')], [segment('c1-0', 'A perspicacious remark.')]]);
    const [toc] = project.chapters;
    if (toc) toc.title = 'Table of Contents';
    expect(selectHintCandidates(project, en, { level: 3 })[0]?.occurrences.map((o) => o.segmentId)).toEqual(['c1-0']);
  });
});

describe('selection edge cases', () => {
  it('collects every form of a qualifying lemma with its own rank, also the forms too common for the level', () => {
    const project = makeProject([[segment('c0-0', 'Delays frustrate everyone here.')], [segment('c1-0', 'It was a frustrating morning.')]]);
    expect(en.rank('frustrate') ?? 0).toBeGreaterThan(hintRankThreshold(1));
    expect(en.rank('frustrating') ?? 0).toBeLessThanOrEqual(hintRankThreshold(1));
    const [candidate] = selectHintCandidates(project, en, { level: 1 }).filter((c) => c.lemma === 'frustrate');
    expect(candidate?.occurrences.map((o) => [o.word, o.rank])).toEqual([
      ['frustrate', en.rank('frustrate')],
      ['frustrating', en.rank('frustrating')],
    ]);
    expect(candidate?.rank).toBe(en.rank('frustrate'));
    // A lemma whose base form is too common never qualifies through any form.
    expect(lemmas(makeProject([[segment('c0-0', 'They believe and believed.')]]), en, 1)).toEqual([]);
  });

  it('never treats corpus debris such as "quot" as a word or lemma', () => {
    const project = makeProject([[segment('c0-0', 'Quoting him, she wrote quot and nbsp; then kept quoting.')]]);
    const found = selectHintCandidates(project, en, { level: 5 });
    expect(found.map((c) => c.lemma)).not.toContain('quot');
    expect(found.map((c) => c.lemma)).not.toContain('nbsp');
  });

  it('skips drop caps and words split by inline markup on both sides of the tag', () => {
    const project = makeProject([
      [
        segment('c0-0', '<p><span class="dropcap">A</span>lthough perspicacious, he was truculent.</p>'),
        segment('c0-1', '<p><b>W</b>hen the <i>un</i>usual obfuscation began, <span>D</span>arkness fell.</p>'),
      ],
    ]);
    const found = lemmas(project, en, 1);
    for (const fragment of ['lthough', 'hen', 'usual', 'arkness', 'un']) expect(found).not.toContain(fragment);
    expect(found).toEqual(expect.arrayContaining(['perspicacious', 'truculent', 'obfuscation']));
  });

  it('skips names after an opening bracket, quote or colon in prose, and capitalized words the book never writes in lowercase', () => {
    const project = makeProject([
      [
        segment('c0-0', 'As argued (Churchill, 1950) and as he said: "Clarendon was right." Bloomberg reported it.'),
        segment('c0-1', 'Later Bloomberg agreed. Perspicacious readers noticed. He was truculent.'),
        segment('c0-2', 'Truculent men, perspicacious women.'),
      ],
    ]);
    const found = lemmas(project, en, 5);
    for (const name of ['churchill', 'clarendon', 'bloomberg']) expect(found).not.toContain(name);
    expect(found).toEqual(expect.arrayContaining(['perspicacious', 'truculent']));
    // A rare word at the start of one sentence is still hinted although the book never writes it in lowercase.
    expect(lemmas(makeProject([[segment('c0-0', 'Ostensibly, he left.')]]), en, 3)).toContain('ostensibly');
  });

  it('never hints link text, form controls, fallback content or ruby, but keeps plain anchors', () => {
    const project = makeProject([
      [
        segment(
          'c0-0',
          '<p><a href="#i1">perspicacious</a> <option>truculent</option> <button>obfuscation</button> <noscript>pusillanimous</noscript> <ruby>sesquipedalian<rt>x</rt></ruby> <a id="here">lugubrious</a></p>',
        ),
      ],
    ]);
    expect(lemmas(project, en, 1)).toEqual(['lugubrious']);
  });
});

describe('gloss cleaning', () => {
  it('keeps balanced brackets and quotes inside a gloss, drops wrapping ones and trailing punctuation', () => {
    expect(cleanGloss('bank (river)')).toBe('bank (river)');
    expect(cleanGloss('"bank (river)".')).toBe('bank (river)');
    expect(cleanGloss('it\'s "q"')).toBe('it\'s "q"');
    expect(cleanGloss('(a) or (b)')).toBe('(a) or (b)');
    expect(cleanGloss('«mot»')).toBe('mot');
    expect(cleanGloss('「言葉」。')).toBe('言葉');
    expect(cleanGloss('"word')).toBe('word');
  });

  it('strips XML-invalid and format characters but keeps ZWNJ/ZWJ', () => {
    expect(cleanGloss('non\uFFFEchar\uFFFF')).toBe('nonchar');
    expect(cleanGloss('x\uD800y')).toBe('xy');
    expect(cleanGloss('a\u0001b\u202Ec')).toBe('ab c');
    expect(cleanGloss('می\u200Cخواهم')).toBe('می\u200Cخواهم');
    expect(cleanGloss('क्\u200Dष')).toBe('क्\u200Dष');
  });
});

describe('hint text and contexts', () => {
  it('reads eligible text chunks from serialized markup', () => {
    expect(hintTextChunks('<p>A &amp; B<br/>C <code>x()</code> D<sup>1</sup>.</p>').map((c) => c.text)).toEqual(['A & B', ' ', 'C ', ' ', ' D', ' ', '.']);
  });

  it('marks text glued to a letter across a tag, but not across spaces, punctuation, block tags or CJK', () => {
    const glue = (html: string) => hintTextChunks(html).map((c) => `${c.text}${c.glue.before ? '<' : ''}${c.glue.after ? '>' : ''}`);
    expect(glue('<span class="dropcap">A</span>lthough')).toEqual(['A>', 'lthough<']);
    expect(glue('<b>W</b>hen <i>un</i>usual')).toEqual(['W>', 'hen <', 'un>', 'usual<']);
    expect(glue('<i>Darcy</i>’s <b>word</b>, then')).toEqual(['Darcy', '’s ', 'word', ', then']);
    expect(glue('<div>end</div><div>start</div>')).toEqual(['end', ' ', 'start']);
    expect(glue('<b>彼は</b>躊躇')).toEqual(['彼は', '躊躇']);
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
