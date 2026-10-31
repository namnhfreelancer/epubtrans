import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';
import type { ChatProvider, ChatRequest, ChatResponse, DomEnv, FrequencyList, Project, Segment, WordHintLanguage } from '../src';
import { createDefaultSettings, parseFrequencyList } from '../src';
import { readZip } from '../src/util/zip-archive';

/** linkedom has no XMLSerializer; its nodes serialize themselves (XML syntax for XML documents). */
class LinkedomXMLSerializer {
  serializeToString(node: Node): string {
    return String(node);
  }
}

export const env: DomEnv = {
  DOMParser: DOMParser as unknown as typeof globalThis.DOMParser,
  XMLSerializer: LinkedomXMLSerializer as unknown as typeof globalThis.XMLSerializer,
};

export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
}

export function unzipText(bytes: Uint8Array, path: string): string {
  const data = readZip(bytes).get(path);
  if (!data) throw new Error(`missing ${path}`);
  return new TextDecoder().decode(data);
}

/** Echo "translator": wraps the text of each segment in a marker, keeping the markup intact. */
export function fakeTranslate(html: string): string {
  return html.replace(/>([^<]+)</g, (_, t: string) => `>${t.trim() ? `[vi] ${t}` : t}<`).replace(/^([^<]+)/, (t) => `[vi] ${t}`);
}

export type ChatHandler = (req: ChatRequest, call: number) => Promise<ChatResponse> | ChatResponse;

/** Mock ChatProvider recording every request. */
export function mockProvider(handler: ChatHandler): ChatProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    calls,
    listModels: async () => ['mock-model'],
    chat: async (req) => {
      calls.push(req);
      return handler(req, calls.length);
    },
  };
}

/** Answers every translate/review request by echoing segments through `fakeTranslate`. */
export function answerAll(req: ChatRequest): ChatResponse {
  const input = JSON.parse(req.user) as { segments: { id: string; html?: string; source?: string; draft?: string }[] };
  const segments = input.segments.map((s) => ({ id: s.id, html: s.draft !== undefined ? `${s.draft}` : fakeTranslate(s.html ?? '') }));
  return { text: JSON.stringify({ segments }), usage: { input: 100, output: 50 } };
}

export function segment(id: string, sourceHtml: string, status: Segment['status'] = 'pending'): Segment {
  return { id, sourceHtml, sourceText: sourceHtml.replace(/<[^>]+>/g, ''), status };
}

export function makeProject(segments: Segment[][]): Project {
  return {
    schemaVersion: 1,
    id: 'p1',
    title: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: createDefaultSettings({ model: 'mock-model', targetLang: 'vi', sourceLang: 'en' }),
    chapters: segments.map((segs, i) => ({ href: `OEBPS/c${i}.xhtml`, title: `Chapter ${i}`, segments: segs })),
    sourceEpub: new Uint8Array(),
  };
}

/** The committed word frequency list of a language (`data/wordfreq/<lang>.txt`). */
export function readFrequencyList(lang: WordHintLanguage): FrequencyList {
  return parseFrequencyList(lang, readFileSync(fileURLToPath(new URL(`../data/wordfreq/${lang}.txt`, import.meta.url)), 'utf8'));
}

/** A frequency list with `ranked` words at the given ranks; every other rank up to the highest is a filler word. */
export function rankedList(lang: WordHintLanguage, ranked: Record<string, number>): FrequencyList {
  const max = Math.max(200, ...Object.values(ranked));
  const lines = Array.from({ length: max }, (_, i) => `filler${i + 1}`);
  for (const [word, rank] of Object.entries(ranked)) lines[rank - 1] = word;
  return parseFrequencyList(lang, `# test list\n${lines.join('\n')}\n`);
}

export interface GlossItem {
  id: string;
  word: string;
  lemma: string;
  context: string;
  senses?: { id: string; gloss: string }[];
}

type GlossAnswerFn = (item: GlossItem, call: number) => Record<string, unknown> | undefined;

/** Mock provider answering gloss requests item by item (default: sense "main", gloss "≈lemma"); undefined leaves an item out. */
export function glossProvider(answer: GlossAnswerFn = (i) => ({ sense: 'main', gloss: `≈${i.lemma}` })) {
  return mockProvider((req, call) => {
    const { items } = JSON.parse(req.user) as { items: GlossItem[] };
    const out = items.flatMap((item) => {
      const a = answer(item, call);
      return a ? [{ id: item.id, ...a }] : [];
    });
    return { text: JSON.stringify({ items: out }), usage: { input: 50, output: 20 } };
  });
}
