/** Common translation languages offered in the pickers; any other valid BCP 47 tag can be typed in. */
export const COMMON_LANGUAGES = [
  'en',
  'vi',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt',
  'pt-BR',
  'it',
  'ru',
  'uk',
  'pl',
  'nl',
  'sv',
  'da',
  'nb',
  'fi',
  'cs',
  'el',
  'hu',
  'ro',
  'tr',
  'ar',
  'he',
  'fa',
  'hi',
  'bn',
  'th',
  'id',
  'ms',
  'fil',
];

/** Canonical BCP 47 tag, or undefined when the input is not a valid tag. Accepts "vi — Vietnamese" style input. */
export function normalizeLanguageTag(input: string): string | undefined {
  const tag = (input.split(/\s+[—–]\s+/)[0] ?? '').trim();
  if (!tag || tag.length > 35 || /\s/.test(tag)) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** Display name of a language tag in the UI language, e.g. ('vi', 'en') → 'Vietnamese'. */
export function languageLabel(tag: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: 'language', fallback: 'none' }).of(tag);
    return name ?? tag;
  } catch {
    return tag;
  }
}
