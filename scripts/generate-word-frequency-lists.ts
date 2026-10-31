/**
 * Regenerates the word frequency rank lists used by Word Wise hints (`packages/core/data/wordfreq/<lang>.txt`)
 * from the published data of wordfreq (https://github.com/rspeer/wordfreq, data CC BY-SA 4.0, code Apache-2.0).
 * Not run in CI: the output is committed. Run it only to change the languages, the list size or the wordfreq version.
 *
 *   bun scripts/generate-word-frequency-lists.ts [--words N] [--version v3.2] [lang ...]
 *
 * Without --words: 100k words for English, 30k for the other languages.
 *
 * wordfreq ships each language as a gzipped msgpack "cBpack": a header map followed by one list of words per
 * centibel of frequency (bucket i holds the words with frequency ≈ 10^(-i/100)), most frequent first. The script
 * flattens the buckets in order, keeps word-like tokens (letters and marks, inner apostrophes; no digits, no
 * hyphenated compounds, which Intl.Segmenter splits anyway) and writes the first N, one per line, most frequent
 * first. Line number = frequency rank.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Languages and the wordfreq list to use: `large` where published (words down to Zipf 1), else `small` (Zipf 3+).
 * English keeps a deeper list because its lemmatizer validates base forms against it ("obfuscated" → "obfuscate",
 * rank ~67k); other languages match exact forms, where 30k words cover the difficulty levels.
 */
const LANGUAGES: Record<string, 'large' | 'small'> = {
  en: 'large',
  fr: 'large',
  de: 'large',
  es: 'large',
  it: 'large',
  pt: 'large',
  ru: 'large',
  nl: 'large',
  pl: 'large',
  sv: 'large',
  uk: 'large',
  cs: 'large',
  ja: 'large',
  zh: 'large',
  ko: 'small',
};
const DEFAULT_WORDS = 30_000;
const WORDS_BY_LANGUAGE: Record<string, number> = { en: 100_000 };

const WORD = /^[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*$/u;

function parseFlags(argv: string[]): { words: number | undefined; version: string; langs: string[] } {
  let words: number | undefined;
  let version = 'v3.2';
  const langs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--words') words = Number(argv[++i]);
    else if (arg === '--version') version = String(argv[++i]);
    else langs.push(arg);
  }
  if (words !== undefined && (!Number.isInteger(words) || words < 1000)) throw new Error('--words must be an integer >= 1000');
  for (const lang of langs) if (!(lang in LANGUAGES)) throw new Error(`Unknown language "${lang}"; known: ${Object.keys(LANGUAGES).join(', ')}`);
  return { words, version, langs: langs.length ? langs : Object.keys(LANGUAGES) };
}

/** Minimal msgpack decoder: the subset wordfreq's cBpack files use (arrays, maps, strings, integers, nil, booleans). */
function decodeMsgpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  let pos = 0;
  const str = (n: number) => {
    const s = text.decode(bytes.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const array = (n: number): unknown[] => Array.from({ length: n }, () => read());
  const map = (n: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) out[String(read())] = read();
    return out;
  };
  const read = (): unknown => {
    const b = view.getUint8(pos++);
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);
    if (b >= 0x90 && b <= 0x9f) return array(b & 0x0f);
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    const take = (n: number, get: (o: number) => number) => {
      const v = get(pos);
      pos += n;
      return v;
    };
    switch (b) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc:
        return take(1, (o) => view.getUint8(o));
      case 0xcd:
        return take(2, (o) => view.getUint16(o));
      case 0xce:
        return take(4, (o) => view.getUint32(o));
      case 0xd0:
        return take(1, (o) => view.getInt8(o));
      case 0xd1:
        return take(2, (o) => view.getInt16(o));
      case 0xd2:
        return take(4, (o) => view.getInt32(o));
      case 0xd9:
        return str(take(1, (o) => view.getUint8(o)));
      case 0xda:
        return str(take(2, (o) => view.getUint16(o)));
      case 0xdb:
        return str(take(4, (o) => view.getUint32(o)));
      case 0xdc:
        return array(take(2, (o) => view.getUint16(o)));
      case 0xdd:
        return array(take(4, (o) => view.getUint32(o)));
      case 0xde:
        return map(take(2, (o) => view.getUint16(o)));
      case 0xdf:
        return map(take(4, (o) => view.getUint32(o)));
      default:
        throw new Error(`Unsupported msgpack byte 0x${b.toString(16)} at ${pos - 1}`);
    }
  };
  return read();
}

async function buildList(lang: string, size: 'large' | 'small', version: string, words: number): Promise<string[]> {
  const url = `https://raw.githubusercontent.com/rspeer/wordfreq/${version}/wordfreq/data/${size}_${lang}.msgpack.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  const data = decodeMsgpack(gunzipSync(new Uint8Array(await res.arrayBuffer())));
  if (!Array.isArray(data) || typeof data[0] !== 'object' || (data[0] as { format?: unknown }).format !== 'cB') throw new Error(`${url} is not a cBpack`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const bucket of data.slice(1)) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      const word = String(raw).normalize('NFC').replace(/’/g, "'");
      if (!WORD.test(word) || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
      if (out.length >= words) return out;
    }
  }
  return out;
}

const { words, version, langs } = parseFlags(process.argv.slice(2));
const outDir = resolve(import.meta.dir, '../packages/core/data/wordfreq');
await mkdir(outDir, { recursive: true });
for (const lang of langs) {
  const size = LANGUAGES[lang] as 'large' | 'small';
  const list = await buildList(lang, size, version, words ?? WORDS_BY_LANGUAGE[lang] ?? DEFAULT_WORDS);
  const header = `# wordfreq ${version} ${size}_${lang}: top ${list.length} words by frequency, most frequent first. Data CC BY-SA 4.0, https://github.com/rspeer/wordfreq`;
  const file = join(outDir, `${lang}.txt`);
  await writeFile(file, `${header}\n${list.join('\n')}\n`);
  console.log(`wrote ${file} (${list.length} words)`);
}
