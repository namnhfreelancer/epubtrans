import { strFromU8, strToU8 } from 'fflate';
import { isGlossaryTermType } from '../glossary/glossary-entry';
import type { Chapter, GlossaryEntry, Project, ProjectSettings, Segment, SegmentStatus } from '../types';
import { readZip, writeZip } from '../util/zip-archive';

/**
 * `.epubtrans` project file: a zip with `project.json` (schema-versioned state without the
 * book bytes) and `source.epub` (the normalized, segment-marked package).
 */
const PROJECT_JSON = 'project.json';
const SOURCE_EPUB = 'source.epub';
const STATUSES: SegmentStatus[] = ['pending', 'translated', 'reviewed', 'error'];

export async function saveProjectFile(project: Project): Promise<Uint8Array> {
  const { sourceEpub, ...state } = project;
  return writeZip(
    new Map([
      [PROJECT_JSON, strToU8(JSON.stringify(state))],
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
  return {
    schemaVersion: 1,
    id: str(p, 'id', 'project'),
    title: str(p, 'title', 'project'),
    ...(author !== undefined ? { author } : {}),
    createdAt: str(p, 'createdAt', 'project'),
    updatedAt: str(p, 'updatedAt', 'project'),
    settings: validateSettings(obj(p.settings, 'project.settings')),
    chapters: arr(p, 'chapters', 'project').map((c, i) => validateChapter(obj(c, `chapters[${i}]`), `chapters[${i}]`)),
  };
}

function validateSettings(s: Json): ProjectSettings {
  const path = 'settings';
  if (typeof s.twoPass !== 'boolean') fail(`${path}.twoPass`, 'a boolean');
  const concurrency = optNum(s, 'concurrency', path) ?? fail(`${path}.concurrency`, 'a number');
  const priceInPerM = optNum(s, 'priceInPerM', path);
  const priceOutPerM = optNum(s, 'priceOutPerM', path);
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
      return {
        id: str(seg, 'id', sp),
        sourceHtml: str(seg, 'sourceHtml', sp),
        sourceText: str(seg, 'sourceText', sp),
        status,
        ...(translationHtml !== undefined ? { translationHtml } : {}),
        ...(error !== undefined ? { error } : {}),
      };
    }),
  };
}
