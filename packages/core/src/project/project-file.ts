import { strFromU8, strToU8 } from 'fflate';
import { isGlossaryTermType } from '../glossary/glossary-entry';
import type {
  Chapter,
  GlossaryEntry,
  Project,
  ProjectSettings,
  SampleSelection,
  Segment,
  SegmentStatus,
  WordHintEntry,
  WordHintSettings,
  WordHints,
} from '../types';
import { redactSecrets } from '../util/redact-secrets';
import { readZip, writeZip } from '../util/zip-archive';
import { clampHintLevel, defaultWordHintSettings, MAX_HINTS_PER_CHAPTER_LIMIT, MAX_HINTS_PER_PARAGRAPH_LIMIT } from '../word-hints/hint-levels';

/**
 * `.epubtrans` project file: a zip with `project.json` (schema-versioned state without the
 * book bytes) and `source.epub` (the normalized, segment-marked package).
 */
const PROJECT_JSON = 'project.json';
const SOURCE_EPUB = 'source.epub';
const STATUSES: SegmentStatus[] = ['pending', 'translated', 'reviewed', 'error'];

export async function saveProjectFile(project: Project): Promise<Uint8Array> {
  const { sourceEpub, ...state } = project;
  // Project files get shared: segment errors may carry text a provider echoed, so they are redacted on the way out.
  const chapters = state.chapters.map((c) => ({
    ...c,
    segments: c.segments.map((s) => (s.error === undefined ? s : { ...s, error: redactSecrets(s.error) })),
  }));
  return writeZip(
    new Map([
      [PROJECT_JSON, strToU8(JSON.stringify({ ...state, chapters }))],
      [SOURCE_EPUB, sourceEpub],
    ]),
  );
}

export async function loadProjectFile(bytes: Uint8Array): Promise<Project> {
  const files = readZip(bytes);
  const json = files.get(PROJECT_JSON);
  const sourceEpub = files.get(SOURCE_EPUB);
  if (!json || !sourceEpub) throw new Error('Not an epubtrans project file (missing project.json or source.epub)');
  let state: unknown;
  try {
    state = JSON.parse(strFromU8(json));
  } catch {
    throw new Error('project.json is not valid JSON');
  }
  return { ...validateProjectState(state), sourceEpub };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(path: string, expected: string): never {
  throw new Error(`Invalid project file: ${path} must be ${expected}`);
}
function str(o: Json, key: string, path: string): string {
  const v = o[key];
  return typeof v === 'string' ? v : fail(`${path}.${key}`, 'a string');
}
function optStr(o: Json, key: string, path: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, path);
}
function optNum(o: Json, key: string, path: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(`${path}.${key}`, 'a number');
}
function arr(o: Json, key: string, path: string): unknown[] {
  const v = o[key];
  return Array.isArray(v) ? v : fail(`${path}.${key}`, 'an array');
}
function obj(v: unknown, path: string): Json {
  return isObj(v) ? v : fail(path, 'an object');
}

/** Validates untrusted project state (project file, IndexedDB) and returns a clean copy. */
export function validateProjectState(input: unknown): Omit<Project, 'sourceEpub'> {
  const p = obj(input, 'project');
  if (p.schemaVersion !== 1) throw new Error(`Unsupported project schema version: ${String(p.schemaVersion)}`);
  const author = optStr(p, 'author', 'project');
  const lastSample = p.lastSample === undefined ? undefined : validateSample(obj(p.lastSample, 'project.lastSample'));
  const wordHints = p.wordHints === undefined || p.wordHints === null ? undefined : validateWordHints(obj(p.wordHints, 'project.wordHints'));
  return {
    schemaVersion: 1,
    id: str(p, 'id', 'project'),
    title: str(p, 'title', 'project'),
    ...(author !== undefined ? { author } : {}),
    createdAt: str(p, 'createdAt', 'project'),
    updatedAt: str(p, 'updatedAt', 'project'),
    settings: validateSettings(obj(p.settings, 'project.settings')),
    chapters: arr(p, 'chapters', 'project').map((c, i) => validateChapter(obj(c, `chapters[${i}]`), `chapters[${i}]`)),
    ...(lastSample !== undefined ? { lastSample } : {}),
    ...(wordHints !== undefined ? { wordHints } : {}),
  };
}

function validateSample(s: Json): SampleSelection {
  const path = 'lastSample';
  const seed = optNum(s, 'seed', path) ?? fail(`${path}.seed`, 'a number');
  return {
    seed,
    passages: arr(s, 'passages', path).map((raw, i) => {
      const p = obj(raw, `${path}.passages[${i}]`);
      const pp = `${path}.passages[${i}]`;
      return {
        chapterHref: str(p, 'chapterHref', pp),
        chapterTitle: str(p, 'chapterTitle', pp),
        segmentIds: arr(p, 'segmentIds', pp).map((id) => (typeof id === 'string' ? id : fail(`${pp}.segmentIds`, 'an array of strings'))),
      };
    }),
  };
}

function validateSettings(s: Json): ProjectSettings {
  const path = 'settings';
  if (typeof s.twoPass !== 'boolean') fail(`${path}.twoPass`, 'a boolean');
  const concurrency = optNum(s, 'concurrency', path) ?? fail(`${path}.concurrency`, 'a number');
  const priceInPerM = optNum(s, 'priceInPerM', path);
  const priceOutPerM = optNum(s, 'priceOutPerM', path);
  const wordHints = s.wordHints === undefined || s.wordHints === null ? undefined : validateWordHintSettings(obj(s.wordHints, `${path}.wordHints`));
  return {
    sourceLang: str(s, 'sourceLang', path),
    targetLang: str(s, 'targetLang', path),
    providerId: str(s, 'providerId', path),
    baseURL: str(s, 'baseURL', path),
    model: str(s, 'model', path),
    concurrency,
    twoPass: s.twoPass as boolean,
    guideline: str(s, 'guideline', path),
    glossary: arr(s, 'glossary', path).map((g, i) => validateGlossaryEntry(obj(g, `${path}.glossary[${i}]`), `${path}.glossary[${i}]`)),
    ...(priceInPerM !== undefined ? { priceInPerM } : {}),
    ...(priceOutPerM !== undefined ? { priceOutPerM } : {}),
    ...(wordHints !== undefined ? { wordHints } : {}),
  };
}

const countLimit = (v: number | undefined, fallback: number, max: number) => (v === undefined ? fallback : Math.min(max, Math.max(0, Math.round(v))));

/** Hint options are clamped to their ranges (an unknown style becomes ruby), so a slightly off file still loads. */
function validateWordHintSettings(h: Json): WordHintSettings {
  const path = 'settings.wordHints';
  const defaults = defaultWordHintSettings();
  if (h.enabled !== undefined && typeof h.enabled !== 'boolean') fail(`${path}.enabled`, 'a boolean');
  const level = optNum(h, 'level', path);
  const glossLang = optStr(h, 'glossLang', path)?.trim();
  return {
    enabled: h.enabled === true,
    level: level === undefined ? defaults.level : clampHintLevel(level),
    ...(glossLang ? { glossLang } : {}),
    style: h.style === 'inline' ? 'inline' : 'ruby',
    maxPerParagraph: countLimit(optNum(h, 'maxPerParagraph', path), defaults.maxPerParagraph, MAX_HINTS_PER_PARAGRAPH_LIMIT),
    perChapter: countLimit(optNum(h, 'perChapter', path), defaults.perChapter, MAX_HINTS_PER_CHAPTER_LIMIT),
  };
}

/** Longest gloss or label accepted from a file: generation caps them far lower, this only bounds untrusted input. */
const MAX_HINT_TEXT = 200;

function validateWordHints(h: Json): WordHints {
  const path = 'wordHints';
  return {
    sourceLang: str(h, 'sourceLang', path),
    glossLang: str(h, 'glossLang', path),
    entries: arr(h, 'entries', path).map((raw, i) => validateWordHintEntry(obj(raw, `${path}.entries[${i}]`), `${path}.entries[${i}]`)),
  };
}

function boundedStr(o: Json, key: string, path: string): string {
  const v = str(o, key, path);
  return v.length <= MAX_HINT_TEXT ? v : fail(`${path}.${key}`, `at most ${MAX_HINT_TEXT} characters`);
}

/** Every occurrence must name a sense of its entry; a gloss is plain text and is only ever written as a text node. */
function validateWordHintEntry(e: Json, path: string): WordHintEntry {
  const rank = optNum(e, 'rank', path) ?? fail(`${path}.rank`, 'a number');
  const senses = arr(e, 'senses', path).map((raw, i) => {
    const s = obj(raw, `${path}.senses[${i}]`);
    return { id: boundedStr(s, 'id', `${path}.senses[${i}]`), gloss: boundedStr(s, 'gloss', `${path}.senses[${i}]`) };
  });
  const ids = new Set(senses.map((s) => s.id));
  return {
    lemma: boundedStr(e, 'lemma', path),
    rank,
    senses,
    occurrences: arr(e, 'occurrences', path).map((raw, i) => {
      const op = `${path}.occurrences[${i}]`;
      const o = obj(raw, op);
      const nth = optNum(o, 'nth', op);
      if (nth === undefined || nth < 0 || !Number.isInteger(nth)) fail(`${op}.nth`, 'a non-negative integer');
      const sense = str(o, 'sense', op);
      if (!ids.has(sense)) fail(`${op}.sense`, 'the id of a sense of its entry');
      return { segmentId: str(o, 'segmentId', op), word: boundedStr(o, 'word', op), nth, sense };
    }),
  };
}

/** `type` and `count` are optional (absent in v3.0 files); an unknown future `type` is dropped rather than rejected. */
function validateGlossaryEntry(e: Json, path: string): GlossaryEntry {
  const note = optStr(e, 'note', path);
  const type = optStr(e, 'type', path);
  const count = optNum(e, 'count', path);
  if (count !== undefined && (count < 0 || !Number.isInteger(count))) fail(`${path}.count`, 'a non-negative integer');
  return {
    term: str(e, 'term', path),
    translation: str(e, 'translation', path),
    ...(note !== undefined ? { note } : {}),
    ...(type !== undefined && isGlossaryTermType(type) ? { type } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

function validateChapter(c: Json, path: string): Chapter {
  return {
    href: str(c, 'href', path),
    title: str(c, 'title', path),
    segments: arr(c, 'segments', path).map((s, i): Segment => {
      const seg = obj(s, `${path}.segments[${i}]`);
      const sp = `${path}.segments[${i}]`;
      const status = seg.status as SegmentStatus;
      if (!STATUSES.includes(status)) fail(`${sp}.status`, STATUSES.join('|'));
      const translationHtml = optStr(seg, 'translationHtml', sp);
      const error = optStr(seg, 'error', sp);
      // Optional and absent in older files; only `true` is kept, so the field never appears as `false`.
      if (seg.userEdited !== undefined && typeof seg.userEdited !== 'boolean') fail(`${sp}.userEdited`, 'a boolean');
      return {
        id: str(seg, 'id', sp),
        sourceHtml: str(seg, 'sourceHtml', sp),
        sourceText: str(seg, 'sourceText', sp),
        status,
        ...(translationHtml !== undefined ? { translationHtml } : {}),
        ...(error !== undefined ? { error: redactSecrets(error) } : {}),
        ...(seg.userEdited === true ? { userEdited: true } : {}),
      };
    }),
  };
}
