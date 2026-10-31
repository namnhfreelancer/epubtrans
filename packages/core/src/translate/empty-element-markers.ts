import { decodeAttributeValue, type HtmlTag, tokenizeTags } from './html-tag-tokenizer';
import { FORBIDDEN_ELEMENTS, HIDDEN_MARKUP, VOID_ELEMENTS } from './markup-validation';

/**
 * Empty inline elements such as page markers (`<a id="p49"></a>`, `<span epub:type="pagebreak" id="p12"></span>`)
 * carry no text, so a model that restructures a sentence has nowhere to put them and tends to drop them,
 * which fails markup validation every time. They are therefore taken out of the HTML sent to the model,
 * together with their relative position in the text, and put back into the validated translation at the
 * same relative position. Void elements (`br`, `img`) and elements with any content stay in the protocol.
 */
export interface DetachedElement {
  /** Original markup, start and end tag, e.g. `<a id="p49"></a>`. */
  markup: string;
  /** Lower-cased element name. */
  name: string;
  /** Share of the text characters that precede the element, from 0 (start) to 1 (end). */
  fraction: number;
}

export interface DetachedMarkup {
  /** The HTML without the detached elements. */
  html: string;
  /** Detached elements in document order. */
  detached: DetachedElement[];
}

/** One visible text character (an entity reference counts as one) and its span in the HTML string. */
interface TextUnit {
  from: number;
  to: number;
  char: string;
}

const ENTITY = /&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y;
const SPACE = /\s/u;
/** Scripts written without spaces between words: a marker may go between any two characters. */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}　-〿＀-￯]/u;

function textUnits(html: string, tags: readonly HtmlTag[]): TextUnit[] {
  const units: TextUnit[] = [];
  let next = 0;
  let i = 0;
  while (i < html.length) {
    const tag = tags[next];
    if (tag && i >= tag.from) {
      i = tag.to;
      next++;
      continue;
    }
    const limit = tag ? tag.from : html.length;
    ENTITY.lastIndex = i;
    const entity = html[i] === '&' ? ENTITY.exec(html)?.[0] : undefined;
    if (entity && i + entity.length <= limit) {
      const decoded = decodeAttributeValue(entity);
      units.push({ from: i, to: i + entity.length, char: decoded !== entity ? decoded : entity === '&nbsp;' ? ' ' : '&' });
      i += entity.length;
      continue;
    }
    const char = String.fromCodePoint(html.codePointAt(i) ?? 0);
    units.push({ from: i, to: i + char.length, char });
    i += char.length;
  }
  return units;
}

/** A start tag that may open a detachable element: not void, not self-closing, not a forbidden element. */
const isContainerStart = (tag: HtmlTag) => !tag.end && !tag.selfClosing && !VOID_ELEMENTS.has(tag.name) && !FORBIDDEN_ELEMENTS.has(tag.name);

/**
 * Outermost elements without any text or void element inside, found with a stack over the tags: `<a id="p49"></a>`,
 * and wrappers holding only such elements, like `<span><a id="x"></a></span>` (detaching only the inner anchor would
 * leave an empty `<span></span>` that the model drops just the same). Tags that do not nest cleanly reset the scan.
 */
function emptyElementRanges(tags: readonly HtmlTag[]): { from: number; to: number; name: string }[] {
  const ranges: { from: number; to: number; name: string }[] = [];
  // Open start tags, each with whether everything since it has been tags of empty elements only.
  const stack: { index: number; empty: boolean }[] = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i] as HtmlTag;
    const previous = tags[i - 1];
    // Text (or anything) between two tags makes every open element non-empty.
    if (previous && previous.to !== tag.from) for (const open of stack) open.empty = false;
    if (isContainerStart(tag)) {
      stack.push({ index: i, empty: true });
      continue;
    }
    if (!tag.end) {
      // Void or self-closing: real content (an image, a line break) for the model to place.
      for (const open of stack) open.empty = false;
      continue;
    }
    const open = stack.pop();
    const start = open ? (tags[open.index] as HtmlTag) : undefined;
    if (!open || !start || start.name !== tag.name) {
      stack.length = 0;
      continue;
    }
    // An element nested in one of the same name (`<a href><a id></a></a>`) is detached alone, never as a unit, so the
    // restore can put it outside: HTML parsers re-parent nested links.
    const nestsSameName = tags.slice(open.index + 1, i).some((inner) => inner.name === start.name);
    if (!open.empty || nestsSameName) {
      for (const outer of stack) outer.empty = false;
      continue;
    }
    // An outer empty element replaces the inner ones it contains.
    while (ranges.length && (ranges[ranges.length - 1] as { from: number }).from >= start.from) ranges.pop();
    ranges.push({ from: start.from, to: tag.to, name: start.name });
  }
  return ranges;
}

/**
 * Removes every non-void element without text or void elements inside (`<a id="p49"></a>`,
 * `<span><a id="x"></a></span>`) from `html` and records its markup and the fraction of text characters before it.
 * Markup the tokenizer cannot fully see (comments, unterminated tags) is returned unchanged, so validation judges
 * it as before.
 */
export function detachEmptyElements(html: string): DetachedMarkup {
  const unchanged = { html, detached: [] };
  if (HIDDEN_MARKUP.test(html)) return unchanged;
  const tags = tokenizeTags(html);
  if (!tags) return unchanged;
  const ranges = emptyElementRanges(tags);
  if (ranges.length === 0) return unchanged;
  const units = textUnits(html, tags);
  let before = 0;
  let kept = '';
  let cursor = 0;
  const detached = ranges.map((range) => {
    while (before < units.length && (units[before] as TextUnit).to <= range.from) before++;
    kept += html.slice(cursor, range.from);
    cursor = range.to;
    return { markup: html.slice(range.from, range.to), name: range.name, fraction: units.length ? before / units.length : 0 };
  });
  return { html: kept + html.slice(cursor), detached };
}

/** A string index where an element may be inserted, with the names of the elements open there. */
interface Slot {
  index: number;
  open: readonly string[];
}

/**
 * Insertion slots grouped by text offset: `slots[k]` holds the indexes between text character k-1 and k
 * (before and after every tag in between), so no slot is ever inside a tag.
 */
function slotsByTextOffset(html: string, tags: readonly HtmlTag[], units: readonly TextUnit[]): Slot[][] {
  const slots: Slot[][] = Array.from({ length: units.length + 1 }, () => []);
  let open: string[] = [];
  let next = 0;
  for (let k = 0; k <= units.length; k++) {
    const gapStart = k === 0 ? 0 : (units[k - 1] as TextUnit).to;
    const gapEnd = k === units.length ? html.length : (units[k] as TextUnit).from;
    const gap = slots[k] as Slot[];
    gap.push({ index: gapStart, open });
    for (let tag = tags[next]; tag && tag.to <= gapEnd; tag = tags[++next]) {
      if (tag.end) {
        const at = open.lastIndexOf(tag.name);
        if (at >= 0) open = open.slice(0, at);
      } else if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) {
        open = [...open, tag.name];
      }
      gap.push({ index: tag.to, open });
    }
  }
  return slots;
}

/** Text offsets where a marker may go: start, end, word starts, and any position next to a no-space script. */
function boundaryOffsets(units: readonly TextUnit[]): number[] {
  const spaced = units.some((u) => SPACE.test(u.char));
  const offsets: number[] = [];
  for (let k = 0; k <= units.length; k++) {
    const prev = units[k - 1]?.char;
    const next = units[k]?.char;
    const boundary =
      prev === undefined ||
      next === undefined ||
      !spaced ||
      (SPACE.test(prev) && !SPACE.test(next)) ||
      NO_SPACE_SCRIPT.test(prev) ||
      NO_SPACE_SCRIPT.test(next);
    if (boundary) offsets.push(k);
  }
  return offsets;
}

/**
 * Puts detached elements back into `html` (a validated translation of the reduced markup) at the same text fraction,
 * snapped to the nearest word start (any character for scripts without spaces), outside tags, as far out of other
 * elements as the position allows and never inside an element of the same name (nested `<a>` would be re-parented
 * by an HTML parser). A fraction of 0 or 1 means the start or end of the fragment; the original order is kept.
 */
export function restoreDetachedElements(html: string, detached: readonly DetachedElement[]): string {
  if (detached.length === 0) return html;
  const tags = tokenizeTags(html) ?? [];
  const units = textUnits(html, tags);
  const slots = slotsByTextOffset(html, tags, units);
  const offsets = boundaryOffsets(units);
  const positions: number[] = [];
  let floor = 0;
  for (const element of detached) {
    // Every element name inside the markup, so a restored `<span><a></a></span>` never lands inside an `<a>` either.
    const names = (tokenizeTags(element.markup) ?? []).filter((t) => !t.end).map((t) => t.name);
    const index = placeElement(element, names.length ? names : [element.name], units.length, offsets, slots, floor) ?? html.length;
    positions.push(index);
    floor = index;
  }
  let out = '';
  let cursor = 0;
  detached.forEach((element, i) => {
    const index = positions[i] as number;
    out += html.slice(cursor, index) + element.markup;
    cursor = index;
  });
  return out + html.slice(cursor);
}

/** `offsets` (ascending) ordered by distance to `target`, the lower one first on a tie. */
function* nearestFirst(offsets: readonly number[], target: number): Generator<number> {
  let hi = offsets.findIndex((k) => k >= target);
  if (hi < 0) hi = offsets.length;
  let lo = hi - 1;
  while (lo >= 0 || hi < offsets.length) {
    const below = offsets[lo];
    const above = offsets[hi];
    if (above === undefined || (below !== undefined && target - below <= above - target)) {
      yield below as number;
      lo--;
    } else {
      yield above;
      hi++;
    }
  }
}

function placeElement(
  element: DetachedElement,
  names: readonly string[],
  total: number,
  offsets: readonly number[],
  slots: readonly Slot[][],
  floor: number,
): number | undefined {
  const target = element.fraction <= 0 ? 0 : element.fraction >= 1 ? total : element.fraction * total;
  for (const k of nearestFirst(offsets, target)) {
    const allowed = (slots[k] ?? []).filter((s) => s.index >= floor && !names.some((name) => s.open.includes(name)));
    if (allowed.length === 0) continue;
    // Shallowest slot first: the marker stays outside formatting elements whenever the gap allows it.
    return allowed.reduce((best, s) => (s.open.length < best.open.length ? s : best)).index;
  }
  return undefined;
}
