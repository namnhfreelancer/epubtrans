import { type CompiledGlossary, compileGlossary, matchPrepared, type PreparedText, prepareText } from '../glossary/glossary-matcher';
import type { Chapter, CostEstimate, GlossaryEntry, Project, ProjectSettings, Segment, TranslateOptions } from '../types';
import { neighboursInOrder, OUTPUT_RATIO, polishContextTokens, translateContextChars } from './estimate-context-size';
import { buildPolishSystemPrompt, buildTranslateSystemPrompt, formatGlossaryEntry, stripTags } from './prompt-protocol';
import { neighbourLookup } from './read-only-context';
import { countCjk, estimateTokens } from './token-estimate';
import { keepsUserEdit, MAX_BATCH_TOKENS, makeBatches, maxSegmentsOf } from './translate-project';

/** JSON envelope per segment in the answer (`{"id":"c1-2","html":""}`). */
const ANSWER_OVERHEAD = 12;
/** Characters of the translate user message around its segments, and the extra ones a glossary list adds. */
const MESSAGE_ENVELOPE = JSON.stringify({ segments: [] }).length;
const GLOSSARY_ENVELOPE = JSON.stringify({ glossary: [], segments: [] }).length - MESSAGE_ENVELOPE;

/** Character counts of a text, from which `estimateTokens` is computed (so counts can be summed exactly). */
interface CharCount {
  chars: number;
  cjk: number;
}
const countChars = (text: string): CharCount => ({ chars: text.length, cjk: countCjk(text) });
const tokensOf = (c: CharCount) => Math.ceil((c.chars - c.cjk) / 4 + c.cjk / 1.5);

/** Facts about one segment that only depend on its source (and, for glossary hits, on the glossary and the draft). */
interface SegmentFacts {
  id: string;
  sourceHtml: string;
  sourceTokens: number;
  /** Size of `{"id":…,"html":…}` in the translate user message. */
  json: CharCount;
  /** Source text tokenized once, then matched against each new glossary. */
  prepared?: PreparedText;
  glossary?: CompiledGlossary;
  sourceHits?: number[];
  /** The draft translation `draftTokens` was computed for. */
  draftHtml?: string;
  draftTokens?: number;
}

/** Per-segment facts, reused across estimates: the web app re-estimates on every project change. */
const factsCache = new WeakMap<Segment, SegmentFacts>();

function factsOf(s: Segment): SegmentFacts {
  const cached = factsCache.get(s);
  if (cached && cached.sourceHtml === s.sourceHtml && cached.id === s.id) return cached;
  const facts: SegmentFacts = {
    id: s.id,
    sourceHtml: s.sourceHtml,
    sourceTokens: estimateTokens(s.sourceHtml),
    json: countChars(JSON.stringify({ id: s.id, html: s.sourceHtml })),
  };
  factsCache.set(s, facts);
  return facts;
}

/**
 * Glossary positions matched by one segment's source. A batch gets the union of its segments' hits: the same entries
 * the per-batch filter finds, except a term split across two segments. The review pass uses the same hits and does
 * not scan the drafts: their names mostly mirror the source, and the review share of the glossary is small.
 */
function segmentHits(s: Segment, facts: SegmentFacts, glossary: CompiledGlossary): number[] {
  if (facts.glossary !== glossary) {
    facts.glossary = glossary;
    facts.prepared ??= prepareText(s.sourceText || stripTags(s.sourceHtml));
    facts.sourceHits = matchPrepared(glossary, facts.prepared);
  }
  return facts.sourceHits as number[];
}

/** Drops the draft facts when the segment's translation changed since they were computed. */
function syncDraft(s: Segment, facts: SegmentFacts): void {
  if (facts.draftHtml === s.translationHtml) return;
  facts.draftHtml = s.translationHtml;
  delete facts.draftTokens;
}

/** Review-pass tokens of the draft: the stored translation, or the expected translation size when there is none. */
function draftTokens(s: Segment, facts: SegmentFacts): number {
  if (!s.translationHtml) return Math.ceil(facts.sourceTokens * OUTPUT_RATIO);
  syncDraft(s, facts);
  facts.draftTokens ??= estimateTokens(s.translationHtml);
  return facts.draftTokens;
}

/** Prompt sizes of each compiled glossary entry, computed once per glossary. */
interface EntrySizes {
  json: CharCount[];
  reviewTokens: number[];
}
const entrySizesCache = new WeakMap<CompiledGlossary, EntrySizes>();

function entrySizes(glossary: CompiledGlossary): EntrySizes {
  let sizes = entrySizesCache.get(glossary);
  if (!sizes) {
    const lines = glossary.entries.map((g: GlossaryEntry) => formatGlossaryEntry(g));
    sizes = { json: lines.map((line) => countChars(JSON.stringify(line))), reviewTokens: lines.map((line) => estimateTokens(line) + 2) };
    entrySizesCache.set(glossary, sizes);
  }
  return sizes;
}

/**
 * Estimates tokens (and USD when both prices are set) for the remaining work of `translateProject`:
 * the translate pass over 'pending'/'error' segments plus, with `twoPass`, the polish pass (about twice the cost).
 * Both include the read-only context (chapter title, neighbouring passages) each request carries. Segments the user
 * edited by hand are left out, as `translateProject` skips them, unless `opts.overwriteUserEdited` is set.
 * The context is sized as an upper bound: a preceding passage this run still translates counts with a translation
 * the size of its source, as it carries one once translated. `opts.contextChapters` is the book the context
 * passages come from when `project` only holds copies of some segments (a sample).
 * Fast enough to run on every project change of a 2000-page book: per-segment facts and glossary hits are cached
 * and summed per batch instead of rebuilding and matching each request.
 */
export function estimateCost(
  project: Project,
  settings: ProjectSettings,
  opts: Pick<TranslateOptions, 'overwriteUserEdited'> & { contextChapters?: readonly Chapter[] } = {},
): CostEstimate {
  const translateSystem = estimateTokens(buildTranslateSystemPrompt(settings, project));
  const reviewSystem = estimateTokens(buildPolishSystemPrompt(settings, project));
  const glossary = settings.glossary.length > 0 ? compileGlossary(settings.glossary) : undefined;
  const sizes = glossary && glossary.entries.length > 0 ? entrySizes(glossary) : undefined;
  // stamp[p] === batch number marks entry p as already counted for the current batch.
  const stamp = new Int32Array(sizes ? sizes.json.length : 0);
  let batchNo = 0;
  const byTokens = (s: Segment) => factsOf(s).sourceTokens;
  const editable = (s: Segment) => !keepsUserEdit(s, opts.overwriteUserEdited);
  const maxSegments = maxSegmentsOf(settings);
  const lookup = opts.contextChapters && neighbourLookup(opts.contextChapters);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const chapter of project.chapters) {
    const todo = chapter.segments.filter((s) => (s.status === 'pending' || s.status === 'error') && editable(s));
    const todoIds = new Set(todo.map((s) => s.id));
    const willTranslate = (s: Segment) => todoIds.has(s.id);
    const inOrder = neighboursInOrder(chapter);
    const translatePosition = (batch: Segment[]) => lookup?.(batch) ?? inOrder(batch);
    for (const batch of makeBatches(todo, MAX_BATCH_TOKENS, byTokens, maxSegments)) {
      batchNo++;
      const message: CharCount = { chars: MESSAGE_ENVELOPE + batch.length - 1, cjk: 0 };
      const context = translateContextChars(translatePosition(batch), willTranslate);
      message.chars += context.chars;
      message.cjk += context.cjk;
      let entries = 0;
      for (const s of batch) {
        const facts = factsOf(s);
        message.chars += facts.json.chars;
        message.cjk += facts.json.cjk;
        outputTokens += Math.ceil(facts.sourceTokens * OUTPUT_RATIO) + ANSWER_OVERHEAD;
        if (!glossary || !sizes) continue;
        for (const p of segmentHits(s, facts, glossary)) {
          if (stamp[p] === batchNo) continue;
          stamp[p] = batchNo;
          const size = sizes.json[p] as CharCount;
          message.chars += size.chars + (entries > 0 ? 1 : 0);
          message.cjk += size.cjk;
          entries++;
        }
      }
      if (entries > 0) message.chars += GLOSSARY_ENVELOPE;
      inputTokens += translateSystem + tokensOf(message);
    }
    if (!settings.twoPass) continue;
    const review = chapter.segments.filter((s) => s.status !== 'reviewed' && editable(s));
    const reviewPosition = neighboursInOrder(chapter);
    for (const batch of makeBatches(review, MAX_BATCH_TOKENS, byTokens, maxSegments)) {
      batchNo++;
      const context = polishContextTokens(reviewPosition(batch));
      let draft = 0;
      let source = 0;
      let glossaryTokens = 0;
      for (const s of batch) {
        const facts = factsOf(s);
        draft += draftTokens(s, facts);
        source += facts.sourceTokens + ANSWER_OVERHEAD;
        if (!glossary || !sizes) continue;
        for (const p of segmentHits(s, facts, glossary)) {
          if (stamp[p] === batchNo) continue;
          stamp[p] = batchNo;
          glossaryTokens += sizes.reviewTokens[p] as number;
        }
      }
      inputTokens += reviewSystem + source + draft + glossaryTokens + context;
      outputTokens += draft + batch.length * ANSWER_OVERHEAD;
    }
  }
  return priceEstimate(inputTokens, outputTokens, settings);
}

/** A token estimate with its USD cost when both prices are set (rounded to 1/100 cent). */
export function priceEstimate(inputTokens: number, outputTokens: number, prices: Pick<ProjectSettings, 'priceInPerM' | 'priceOutPerM'>): CostEstimate {
  const { priceInPerM: pin, priceOutPerM: pout } = prices;
  const priced = typeof pin === 'number' && typeof pout === 'number' && pin >= 0 && pout >= 0;
  return {
    inputTokens,
    outputTokens,
    ...(priced ? { usd: Math.round(((inputTokens * pin + outputTokens * pout) / 1e6) * 10000) / 10000 } : {}),
  };
}
