import { NS } from '../dom/xml-dom-helpers';
import type { ExportMode, Project, WordHintStyle } from '../types';
import { stripXmlInvalidChars } from '../util/xml-chars';
import { hintRankThreshold, wordHintSettingsOf } from '../word-hints/hint-levels';
import { forEachHintTextNode, isGluedToken, OccurrenceIndex, wordTokens } from '../word-hints/hint-text';

export const HINT_RUBY_CLASS = 'et-ww';
export const HINT_INLINE_CLASS = 'et-ww-i';
/** Paragraphs holding ruby hints get extra line height so the glosses above the line do not collide. */
export const HINT_PARAGRAPH_CLASS = 'et-ww-p';

/** One hint to write: the `nth` occurrence of exactly `word` in its segment, with its gloss. */
export interface HintPlacement {
  word: string;
  nth: number;
  gloss: string;
  rank: number;
}

export interface WordHintExport {
  /** Hints per segment id, after the level filter and the density rules. */
  placements: Map<string, HintPlacement[]>;
  style: WordHintStyle;
  glossLang: string;
  /** Language whose word segmentation picked the occurrences; export must segment the same way. */
  segmentLang: string;
}

/**
 * The hints an export writes, or undefined when none apply: hints are off, none were generated, or the mode has no
 * source text (`translation-only`). Level and density are applied here, so changing them needs no new requests:
 * occurrences whose form ranks at or below the level's threshold are dropped (each form has its own rank, so a lemma
 * can show "frustrate" but not "frustrating"), then the first `perChapter` occurrences of each lemma sense per
 * chapter are kept, then the `maxPerParagraph` rarest words of each segment. Glosses lose XML-invalid characters.
 * EPUB 2 packages always get inline hints, since ruby is not part of XHTML 1.1.
 */
export function planWordHintExport(project: Project, mode: ExportMode, epub2: boolean): WordHintExport | undefined {
  const settings = wordHintSettingsOf(project.settings);
  const hints = project.wordHints;
  if (!settings.enabled || !hints || hints.entries.length === 0 || mode === 'translation-only') return undefined;
  const chapterOf = new Map<string, number>();
  project.chapters.forEach((c, i) => {
    for (const s of c.segments) chapterOf.set(s.id, i);
  });
  const threshold = hintRankThreshold(settings.level);
  const perChapter = new Map<string, number>();
  const bySegment = new Map<string, { placement: HintPlacement; order: number }[]>();
  let order = 0;
  for (const entry of hints.entries) {
    const glosses = new Map(entry.senses.map((s) => [s.id, stripXmlInvalidChars(s.gloss).trim()]));
    for (const occ of entry.occurrences) {
      const rank = occ.rank ?? entry.rank;
      const gloss = glosses.get(occ.sense);
      const chapter = chapterOf.get(occ.segmentId);
      if (rank <= threshold || !gloss || chapter === undefined) continue;
      if (settings.perChapter > 0) {
        const key = `${chapter}\u0000${entry.lemma}\u0000${occ.sense}`;
        const seen = perChapter.get(key) ?? 0;
        if (seen >= settings.perChapter) continue;
        perChapter.set(key, seen + 1);
      }
      const list = bySegment.get(occ.segmentId) ?? [];
      list.push({ placement: { word: occ.word, nth: occ.nth, gloss, rank }, order: order++ });
      bySegment.set(occ.segmentId, list);
    }
  }
  const placements = new Map<string, HintPlacement[]>();
  for (const [segmentId, list] of bySegment) {
    const kept =
      settings.maxPerParagraph > 0
        ? [...list].sort((a, b) => b.placement.rank - a.placement.rank || a.order - b.order).slice(0, settings.maxPerParagraph)
        : list;
    placements.set(
      segmentId,
      kept.map((k) => k.placement),
    );
  }
  return { placements, style: epub2 ? 'inline' : settings.style, glossLang: hints.glossLang, segmentLang: hints.sourceLang };
}

function setGlossLang(el: Element, lang: string, xmlLangOnly: boolean): void {
  el.setAttributeNS(NS.XML, 'xml:lang', lang);
  if (!xmlLangOnly) el.setAttribute('lang', lang);
}

/** `word<ruby>…` nodes for one hint. Glosses are model output: they only ever become text nodes. */
function hintNodes(doc: Document, word: string, gloss: string, plan: WordHintExport, xmlLangOnly: boolean): Node[] {
  if (plan.style === 'inline') {
    const span = doc.createElementNS(NS.XHTML, 'span');
    span.setAttribute('class', HINT_INLINE_CLASS);
    setGlossLang(span, plan.glossLang, xmlLangOnly);
    span.appendChild(doc.createTextNode(` (${gloss})`));
    return [doc.createTextNode(word), span];
  }
  // <ruby>word<rp> (</rp><rt>gloss</rt><rp>)</rp></ruby>: ruby-unaware readers show "word (gloss)".
  const ruby = doc.createElementNS(NS.XHTML, 'ruby');
  ruby.setAttribute('class', HINT_RUBY_CLASS);
  ruby.appendChild(doc.createTextNode(word));
  const open = doc.createElementNS(NS.XHTML, 'rp');
  open.appendChild(doc.createTextNode(' ('));
  const rt = doc.createElementNS(NS.XHTML, 'rt');
  setGlossLang(rt, plan.glossLang, xmlLangOnly);
  rt.appendChild(doc.createTextNode(gloss));
  const close = doc.createElementNS(NS.XHTML, 'rp');
  close.appendChild(doc.createTextNode(')'));
  for (const n of [open, rt, close]) ruby.appendChild(n);
  return [ruby];
}

/**
 * Writes the hints of one segment into its source block `el` (before the translation is placed). Occurrences are
 * found by counting words per text node exactly like candidate selection did; an occurrence that no longer matches,
 * or that is glued to a letter across a tag (a drop cap), is skipped. Returns the number of hints written.
 */
export function applyWordHints(el: Element, placements: readonly HintPlacement[], plan: WordHintExport, xmlLangOnly: boolean): number {
  const wanted = new Map<string, Map<number, HintPlacement>>();
  for (const p of placements) {
    const byNth = wanted.get(p.word) ?? new Map<number, HintPlacement>();
    byNth.set(p.nth, p);
    wanted.set(p.word, byNth);
  }
  const counter = new OccurrenceIndex();
  let written = 0;
  forEachHintTextNode(el, (node, glue) => {
    const text = node.data;
    const hits = wordTokens(text, plan.segmentLang).flatMap((t) => {
      const p = wanted.get(t.word)?.get(counter.next(t.word));
      return p && !isGluedToken(text, glue, t) ? [{ index: t.index, word: t.word, gloss: p.gloss }] : [];
    });
    const parent = node.parentNode;
    if (hits.length === 0 || !parent) return;
    const doc = node.ownerDocument;
    let pos = 0;
    for (const hit of hits) {
      if (hit.index > pos) parent.insertBefore(doc.createTextNode(text.slice(pos, hit.index)), node);
      for (const n of hintNodes(doc, hit.word, hit.gloss, plan, xmlLangOnly)) parent.insertBefore(n, node);
      pos = hit.index + hit.word.length;
      written++;
    }
    if (pos < text.length) node.data = text.slice(pos);
    else parent.removeChild(node);
  });
  return written;
}
