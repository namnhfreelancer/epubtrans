import type { ProjectSettings } from '../types';
import { stripTags } from './prompt-protocol';

/** A translation identical to its source is only suspicious when the text has at least this many letters. */
export const DEFAULT_IDENTICAL_MIN_LETTERS = 12;
export const MAX_IDENTICAL_MIN_LETTERS = 1000;

const URL_OR_EMAIL = /\b(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;
const NAMED_ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/giu;

/** Comparable text: tags, entities, URLs and e-mail addresses removed, case and punctuation ignored, spaces collapsed. */
function comparable(html: string): string {
  return stripTags(html)
    .replace(NAMED_ENTITY, ' ')
    .replace(URL_OR_EMAIL, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every word of a cased script starts with a capital: a name, a title or an acronym, which is often left as is. */
function namesOnly(text: string): boolean {
  const words = text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
  return words.length > 0 && words.every((w) => w[0] !== w[0]?.toLowerCase());
}

const baseLanguage = (tag: string) => tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';

/** Letter threshold a run uses: `settings.identicalMinLetters` when valid (0 = off), else the default. */
export function identicalMinLettersOf(settings: Pick<ProjectSettings, 'identicalMinLetters'>): number {
  const n = settings.identicalMinLetters;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_IDENTICAL_MIN_LETTERS ? n : DEFAULT_IDENTICAL_MIN_LETTERS;
}

/**
 * True when a validated translation reads exactly like its source, a likely untranslated echo. Not flagged: the check
 * turned off (`identicalMinLetters: 0`), the same source and target language, texts with fewer letters than the
 * threshold once URLs and e-mail addresses are removed (numbers, punctuation, short labels), and texts whose words all
 * start with a capital letter (names, titles, acronyms). Pure; never blocks a translation.
 */
export function isIdenticalTranslation(
  sourceHtml: string,
  translationHtml: string,
  settings: Pick<ProjectSettings, 'sourceLang' | 'targetLang' | 'identicalMinLetters'>,
): boolean {
  const minLetters = identicalMinLettersOf(settings);
  if (minLetters === 0) return false;
  if (settings.sourceLang !== 'auto' && baseLanguage(settings.sourceLang) === baseLanguage(settings.targetLang)) return false;
  const source = comparable(sourceHtml);
  if (source !== comparable(translationHtml)) return false;
  const letters = source.match(/\p{L}/gu)?.length ?? 0;
  if (letters < minLetters) return false;
  return !namesOnly(stripTags(sourceHtml).replace(URL_OR_EMAIL, ' '));
}
