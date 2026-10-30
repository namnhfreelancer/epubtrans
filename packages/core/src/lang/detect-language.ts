import { franc } from 'franc-min';
import type { Project } from '../types';

/** ISO 639-3 (franc) → shortest BCP 47 tag. Codes without a 2-letter form are already valid BCP 47. */
const TO_BCP47: Record<string, string> = {
  amh: 'am',
  arb: 'ar',
  azj: 'az',
  bel: 'be',
  ben: 'bn',
  bos: 'bs',
  bul: 'bg',
  ces: 'cs',
  cmn: 'zh',
  deu: 'de',
  ell: 'el',
  eng: 'en',
  fra: 'fr',
  fuv: 'ff',
  guj: 'gu',
  hau: 'ha',
  hin: 'hi',
  hrv: 'hr',
  hun: 'hu',
  ibo: 'ig',
  ind: 'id',
  ita: 'it',
  jav: 'jv',
  jpn: 'ja',
  kan: 'kn',
  kaz: 'kk',
  kin: 'rw',
  kor: 'ko',
  lin: 'ln',
  mal: 'ml',
  mar: 'mr',
  mya: 'my',
  nld: 'nl',
  npi: 'ne',
  nya: 'ny',
  pan: 'pa',
  pbu: 'ps',
  pes: 'fa',
  plt: 'mg',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  run: 'rn',
  rus: 'ru',
  sin: 'si',
  som: 'so',
  spa: 'es',
  srp: 'sr',
  sun: 'su',
  swe: 'sv',
  swh: 'sw',
  tam: 'ta',
  tel: 'te',
  tgl: 'tl',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  urd: 'ur',
  uzn: 'uz',
  vie: 'vi',
  yor: 'yo',
  zlm: 'ms',
  zul: 'zu',
  zyb: 'za',
};

const SAMPLE_CHARS = 6000;

/** Converts a franc ISO 639-3 code to BCP 47 ('und' stays 'und'). */
export function iso6393ToBcp47(code: string): string {
  return TO_BCP47[code] ?? code;
}

/** Detects the dominant source language from a sample of segment text spread across the book. */
export function detectLanguage(project: Project): string {
  const texts = project.chapters.flatMap((c) => c.segments.map((s) => s.sourceText)).filter((t) => t.length > 20);
  if (texts.length === 0) return 'und';
  const stride = Math.max(1, Math.floor(texts.length / 60));
  let sample = '';
  for (let i = 0; i < texts.length && sample.length < SAMPLE_CHARS; i += stride) sample += `${texts[i]}\n`;
  return iso6393ToBcp47(franc(sample, { minLength: 10 }));
}
