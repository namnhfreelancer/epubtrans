import { describe, expect, it } from 'vitest';
import { extractGlossaryCandidates } from '../src';
import { detectCandidateScript } from '../src/glossary/extract-candidates';

const terms = (paragraphs: string[], max?: number) => extractGlossaryCandidates(paragraphs, max === undefined ? {} : { maxCandidates: max }).map((c) => c.term);

describe('extractGlossaryCandidates (space-separated scripts)', () => {
  const story = [
    'The night was cold when Harry Potter reached Diagon Alley. He looked for Hermione in the crowd.',
    'Later that week, Harry Potter met Hermione again near Diagon Alley, and they walked to the Ministry of Magic.',
    'Then Hermione said that the Ministry of Magic had closed. Mr. Weasley agreed with Hermione.',
    'When Mr. Weasley came home, the house was quiet. The night was long and cold.',
    'Then Harry asked about the philosopher stone, because the philosopher stone was gone.',
    'Nobody knew where the philosopher stone was hidden. Then everybody slept.',
  ];

  it('finds multi-word names, recurring capitalized words and title names, with counts', () => {
    const found = extractGlossaryCandidates(story);
    const byTerm = new Map(found.map((c) => [c.term, c]));
    expect(byTerm.get('Harry Potter')?.count).toBe(2);
    expect(byTerm.get('Diagon Alley')?.count).toBe(2);
    expect(byTerm.get('Ministry of Magic')?.count).toBe(2);
    expect(byTerm.get('Mr. Weasley')?.count).toBe(2);
    expect(byTerm.get('Hermione')?.count).toBe(4);
    expect(byTerm.get('philosopher stone')?.count).toBe(3);
  });

  it('ignores ordinary words capitalized at a sentence start and single occurrences', () => {
    const found = terms(story);
    for (const word of ['The', 'Then', 'When', 'Later', 'Nobody', 'He', 'Then Hermione', 'Then Harry']) expect(found).not.toContain(word);
    expect(found).not.toContain('night'); // phrases need at least three occurrences
  });

  it('returns up to two context snippets from different paragraphs', () => {
    const hermione = extractGlossaryCandidates(story).find((c) => c.term === 'Hermione');
    expect(hermione?.snippets).toHaveLength(2);
    expect(hermione?.snippets[0]).toContain('Hermione');
    expect(hermione?.snippets[1]).toContain('Hermione');
    expect(hermione?.snippets[0]).not.toBe(hermione?.snippets[1]);
    const long = `${'word '.repeat(60)}Gandalf the Grey arrived. ${'more '.repeat(60)}`;
    const [gandalf] = extractGlossaryCandidates([long, long]).filter((c) => c.term.startsWith('Gandalf'));
    expect(gandalf?.snippets[0]?.startsWith('…')).toBe(true);
    expect(gandalf?.snippets[0]?.endsWith('…')).toBe(true);
    expect(gandalf?.snippets[0]?.length).toBeLessThan(180);
  });

  it('is deterministic and honours maxCandidates', () => {
    expect(terms(story)).toEqual(terms(story));
    expect(terms(story, 2)).toHaveLength(2);
    expect(terms(story, 0)).toEqual([]);
  });

  it('uses frequent phrases for scripts without letter case and skips unsupported scripts', () => {
    const before = ['הוא הלך אל', 'היא ראתה את', 'הם בנו את', 'אנחנו אוהבים את', 'הרב לימד ב'];
    const hebrew = ['הגדול', 'הישן', 'שלנו', 'בעיר', 'החדש'].map((w, i) => `${before[i]} בית המדרש ${w} והתפלל שם`);
    expect(terms(hebrew)).toContain('בית המדרש');
    expect(detectCandidateScript(['สวัสดีครับ ยินดีต้อนรับ'])).toBe('unsupported');
    expect(terms(['สวัสดีครับ ยินดีต้อนรับ', 'สวัสดีครับ'])).toEqual([]);
    expect(terms([])).toEqual([]);
  });
});

describe('extractGlossaryCandidates (CJK)', () => {
  it('finds frequent character n-grams and prefers the longer term', () => {
    const paragraphs = [
      '孙悟空来到花果山。',
      '花果山上，孙悟空吃桃子。',
      '猪八戒问孙悟空为什么去花果山。',
      '孙悟空笑了，花果山很美。',
      '他们离开花果山以后，孙悟空很想家。',
      '孙悟空和猪八戒走了。',
    ];
    expect(detectCandidateScript(paragraphs)).toBe('cjk');
    const found = terms(paragraphs);
    expect(found).toContain('孙悟空');
    expect(found).toContain('花果山');
    expect(found).not.toContain('悟空'); // always part of 孙悟空
    expect(found.every((t) => !t.startsWith('的') && !t.endsWith('了'))).toBe(true);
  });
});

describe('extractGlossaryCandidates performance', () => {
  it('scans a ~300k-word book in under 2 seconds', () => {
    // Deterministic pseudo-random text: common words, recurring names and a few domain phrases.
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const vocab = Array.from({ length: 4000 }, (_, i) => `w${i.toString(36)}ord`);
    const names = Array.from({ length: 300 }, (_, i) => `Name${i.toString(36)} Surname${i.toString(36)}`);
    const common = ['the', 'and', 'of', 'to', 'a', 'in', 'was', 'he', 'she', 'it'];
    const paragraphs: string[] = [];
    let words = 0;
    while (words < 300_000) {
      const parts: string[] = [];
      for (let i = 0; i < 100; i++) {
        const r = rand(20);
        parts.push(r < 8 ? (common[rand(common.length)] as string) : r < 9 ? (names[rand(names.length)] as string) : (vocab[rand(vocab.length)] as string));
        if (rand(12) === 0) parts[parts.length - 1] += '.';
      }
      words += parts.length;
      paragraphs.push(`Once ${parts.join(' ')}.`);
    }
    const started = performance.now();
    const found = extractGlossaryCandidates(paragraphs, { maxCandidates: 800 });
    const elapsed = performance.now() - started;
    expect(found.length).toBeGreaterThan(100);
    expect(found.some((c) => c.term.startsWith('Name'))).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
