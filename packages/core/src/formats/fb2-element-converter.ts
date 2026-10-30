import { ELEMENT_NODE, getAttrLocal, NS, nameOf, TEXT_NODE } from '../dom/xml-dom-helpers';

/**
 * Maps FictionBook 2 elements onto XHTML 5 elements (mapping adapted from foliate-js fb2.js, MIT).
 * Produces nodes owned by the target XHTML document.
 */
const BLOCK_MAP: Record<string, [tag: string, cls?: string]> = {
  section: ['section'],
  p: ['p'],
  subtitle: ['p', 'subtitle'],
  epigraph: ['blockquote', 'epigraph'],
  cite: ['blockquote', 'cite'],
  poem: ['div', 'poem'],
  stanza: ['div', 'stanza'],
  v: ['p', 'v'],
  'text-author': ['p', 'text-author'],
  date: ['p', 'date'],
  annotation: ['div', 'annotation'],
  table: ['table'],
  tr: ['tr'],
  td: ['td'],
  th: ['th'],
};
const INLINE_MAP: Record<string, string> = {
  strong: 'strong',
  emphasis: 'em',
  style: 'span',
  strikethrough: 's',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

export interface Fb2ConvertContext {
  doc: Document;
  /** Section depth, used for heading levels. */
  depth: number;
  usedIds: Set<string>;
  /** Returns an href for an FB2 `#binary-id` image reference, or undefined. */
  imageHref: (ref: string) => string | undefined;
}

export function convertFb2Node(node: Node, ctx: Fb2ConvertContext): Node[] {
  if (node.nodeType === TEXT_NODE) return [ctx.doc.createTextNode((node as Text).data)];
  if (node.nodeType !== ELEMENT_NODE) return [];
  const src = node as Element;
  const name = nameOf(src);
  const children = (c: Fb2ConvertContext = ctx) => Array.from(src.childNodes).flatMap((n) => convertFb2Node(n, c));

  if (name === 'title') {
    const level = Math.max(1, Math.min(ctx.depth, 6));
    const h = el(ctx, `h${level}`, src, 'title');
    const lines = Array.from(src.childNodes).filter((n) => n.nodeType === ELEMENT_NODE && nameOf(n) === 'p');
    lines.forEach((p, i) => {
      if (i > 0) h.appendChild(ctx.doc.createElementNS(NS.XHTML, 'br'));
      for (const n of Array.from(p.childNodes).flatMap((c) => convertFb2Node(c, ctx))) h.appendChild(n);
    });
    return [h];
  }
  if (name === 'empty-line') return [ctx.doc.createElementNS(NS.XHTML, 'br')];
  if (name === 'image') return [image(src, ctx)].filter((n): n is Element => !!n);
  if (name === 'a') {
    const a = el(ctx, 'a', src);
    const href = getAttrLocal(src, 'href');
    if (href) a.setAttribute('href', href);
    if (src.getAttribute('type') === 'note') a.setAttributeNS(NS.EPUB, 'epub:type', 'noteref');
    for (const n of children()) a.appendChild(n);
    return [a];
  }
  const inline = INLINE_MAP[name];
  if (inline) return [append(el(ctx, inline, src), children())];
  const block = BLOCK_MAP[name];
  if (!block) return children();
  const out = el(ctx, block[0], src, block[1]);
  for (const attr of ['colspan', 'rowspan']) {
    const v = src.getAttribute(attr);
    if (v && /^\d+$/.test(v)) out.setAttribute(attr, v);
  }
  return [append(out, children(name === 'section' ? { ...ctx, depth: ctx.depth + 1 } : ctx))];
}

function el(ctx: Fb2ConvertContext, tag: string, src: Element, cls?: string): Element {
  const out = ctx.doc.createElementNS(NS.XHTML, tag);
  const id = src.getAttribute('id');
  if (id && !/\s/.test(id) && !ctx.usedIds.has(id)) {
    ctx.usedIds.add(id);
    out.setAttribute('id', id);
  }
  if (cls) out.setAttribute('class', cls);
  return out;
}

function append(parent: Element, nodes: Node[]): Element {
  for (const n of nodes) parent.appendChild(n);
  return parent;
}

function image(src: Element, ctx: Fb2ConvertContext): Element | undefined {
  const href = ctx.imageHref(getAttrLocal(src, 'href') ?? '');
  if (!href) return undefined;
  const img = ctx.doc.createElementNS(NS.XHTML, 'img');
  img.setAttribute('src', href);
  img.setAttribute('alt', src.getAttribute('alt') ?? '');
  const parent = src.parentNode ? nameOf(src.parentNode) : '';
  if (parent === 'p' || parent === 'v' || parent === 'subtitle' || parent === 'td' || parent === 'th') return img;
  const wrapper = ctx.doc.createElementNS(NS.XHTML, 'div');
  wrapper.setAttribute('class', 'image');
  wrapper.appendChild(img);
  return wrapper;
}
