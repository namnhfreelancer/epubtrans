import { createXhtmlDocument } from '../dom/xhtml-document';
import { estimateTokens } from '../translate/token-estimate';
import type { DomEnv } from '../types';
import { renderInline } from './markdown-inline';
import { MAX_SEGMENT_TOKENS, splitLongText, textPieces } from './split-long-text';

/**
 * Splitting of Markdown text too long for one segment, done on the rendered inline content rather than on the raw text:
 * a cut inside emphasis or a link closes the element at the end of one part and opens a copy of it at the start of the
 * next, so delimiters never turn into literal `*` or `_` and link targets are kept on both sides.
 */

/** Inline content of one element: Markdown text to render, or nodes rendered in a scratch document (to be imported). */
export type InlineContent = string | readonly Node[];

/** Inline nesting deeper than this (hostile input; books nest two or three deep) is split as raw text instead. */
const MAX_SPLIT_DEPTH = 32;
const TEXT_NODE = 3;

/** A piece that goes whole into one part, with the elements around it (outermost first). */
interface Atom {
  node: Node;
  path: readonly Element[];
  tokens: number;
}

const isText = (node: Node): node is Text => node.nodeType === TEXT_NODE;

/** Estimated tokens of an element's tags (name and attributes), the cost of opening it in one more part. */
function markupTokens(el: Element): number {
  let chars = 2 * el.nodeName.length + 5;
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes.item(i);
    if (attr) chars += attr.name.length + attr.value.length + 4;
  }
  return Math.ceil(chars / 4);
}

/** Estimated tokens of every node, children included; undefined when the nesting is deeper than MAX_SPLIT_DEPTH. */
function measure(roots: readonly Node[]): Map<Node, number> | undefined {
  // An explicit stack (no recursion): the depth is only known once it has been walked.
  const order: Node[] = [];
  const stack: [Node, number][] = roots.map((n) => [n, 1]);
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, depth] = item;
    if (depth > MAX_SPLIT_DEPTH) return undefined;
    order.push(node);
    for (let c = node.firstChild; c; c = c.nextSibling) stack.push([c, depth + 1]);
  }
  // Pre-order lists a parent before its children, so the reverse order measures children first.
  const tokens = new Map<Node, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i] as Node;
    let total = isText(node) ? estimateTokens(node.nodeValue ?? '') : markupTokens(node as Element);
    for (let c = node.firstChild; c; c = c.nextSibling) total += tokens.get(c) ?? 0;
    tokens.set(node, total);
  }
  return tokens;
}

/** The pieces of `nodes` in order: whole nodes that fit, sentences of longer text, the children of longer elements. */
function collectAtoms(doc: Document, nodes: readonly Node[], path: readonly Element[], tokens: Map<Node, number>, max: number, out: Atom[]): void {
  for (const node of nodes) {
    const size = tokens.get(node) ?? 0;
    const children: Node[] = [];
    for (let c = node.firstChild; c; c = c.nextSibling) children.push(c);
    if (size <= max || (!isText(node) && children.length === 0)) out.push({ node, path, tokens: size });
    else if (isText(node)) {
      for (const piece of textPieces(node.nodeValue ?? '', max)) out.push({ node: doc.createTextNode(piece), path, tokens: estimateTokens(piece) });
    } else collectAtoms(doc, children, [...path, node as Element], tokens, max, out);
  }
}

/** Removes the whitespace at the end of a part (its last text, however deeply nested). */
function trimPartEnd(part: Node[]): void {
  let node: Node | null | undefined = part.at(-1);
  while (node && !isText(node)) node = node.lastChild;
  if (!node) return;
  node.nodeValue = (node.nodeValue ?? '').trimEnd();
  if (node.nodeValue) return;
  if (node.parentNode) node.parentNode.removeChild(node);
  else part.pop();
}

/** Packs the atoms into parts of at most `max` tokens, re-opening (shallow copies of) the elements a cut falls inside. */
function packAtoms(atoms: readonly Atom[], max: number): Node[][] {
  const parts: Node[][] = [];
  let part: Node[] = [];
  let open: { source: Element; copy: Element }[] = [];
  let used = 0;
  const finish = () => {
    trimPartEnd(part);
    if (part.length) parts.push(part);
    part = [];
    open = [];
    used = 0;
  };
  /** Appends to the innermost open copy (or the part), merging adjacent text. */
  const append = (node: Node) => {
    const parent = open.at(-1)?.copy;
    const last = parent ? parent.lastChild : part.at(-1);
    if (isText(node) && last && isText(last)) last.nodeValue = `${last.nodeValue ?? ''}${node.nodeValue ?? ''}`;
    else if (parent) parent.appendChild(node);
    else part.push(node);
  };
  for (const atom of atoms) {
    if (part.length === 0 && isText(atom.node)) {
      // A part starts at its first word.
      atom.node.nodeValue = (atom.node.nodeValue ?? '').trimStart();
      if (!atom.node.nodeValue) continue;
    }
    let shared = 0;
    while (shared < open.length && shared < atom.path.length && open[shared]?.source === atom.path[shared]) shared++;
    const opening = (from: number) => atom.path.slice(from).reduce((n, el) => n + markupTokens(el), 0);
    if (part.length && used + atom.tokens + opening(shared) > max) {
      finish();
      shared = 0;
      if (isText(atom.node)) {
        atom.node.nodeValue = (atom.node.nodeValue ?? '').trimStart();
        if (!atom.node.nodeValue) continue;
      }
    }
    used += atom.tokens + opening(shared);
    open.length = shared;
    for (const source of atom.path.slice(shared)) {
      const copy = source.cloneNode(false) as Element;
      append(copy);
      open.push({ source, copy });
    }
    append(atom.node);
  }
  finish();
  return parts;
}

/**
 * Returns a function that cuts Markdown text into parts of at most `maxTokens` estimated tokens: shorter text comes back
 * unchanged as the only part; longer text is rendered once (in a scratch document) and its nodes are cut at sentence
 * ends, never inside a word unless a sentence alone is too long. Pathologically deep nesting falls back to cutting the
 * raw text (`splitLongText`), which keeps the work bounded.
 */
export function createInlineSplitter(env: DomEnv, maxTokens = MAX_SEGMENT_TOKENS): (text: string) => InlineContent[] {
  let scratch: Document | undefined;
  return (text) => {
    if (estimateTokens(text) <= maxTokens) return [text];
    scratch ??= createXhtmlDocument(env, '');
    const nodes = renderInline(scratch, text);
    const tokens = measure(nodes);
    if (!tokens) return splitLongText(text, maxTokens);
    const atoms: Atom[] = [];
    collectAtoms(scratch, nodes, [], tokens, maxTokens, atoms);
    const parts = packAtoms(atoms, maxTokens);
    return parts.length > 1 ? parts : [text];
  };
}
