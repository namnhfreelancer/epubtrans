import { PREVIEW_SEGMENT_ATTR } from '@epubtrans/core';
import { openPreviewBook } from './preview-book-loader';
import { openExternalLink } from './preview-external-link';
import type { DevicePreset, PreviewFlow } from './preview-settings';
import type { FoliateBook, TocItem } from './third-party/foliate-js/epub.js';
import type { RelocateDetail, SearchEvent, View } from './third-party/foliate-js/view.js';

export interface PreviewLocation {
  /** Reading position in the whole book, 0..1. */
  fraction: number;
  tocHref?: string;
  tocLabel?: string;
}

export interface PreviewReaderCallbacks {
  onRelocate(location: PreviewLocation): void;
  /** A click on a segment block (not on a link, not ending a text selection). */
  onSegmentClick(segmentId: string): void;
}

export interface PreviewLayout {
  flow: PreviewFlow;
  preset: DevicePreset;
}

const SEGMENT_SELECTOR = `[${PREVIEW_SEGMENT_ATTR}]`;
const ELEMENT_NODE = 1;

const asElement = (node: Node | null | undefined): Element | null => (!node ? null : node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement);

/** Segment block at the start of `range`, or the first one the range touches. */
function segmentAt(range: Range | null | undefined): string | undefined {
  if (!range) return undefined;
  const direct = asElement(range.startContainer)?.closest(SEGMENT_SELECTOR);
  const block = direct ?? Array.from(range.startContainer.ownerDocument?.querySelectorAll(SEGMENT_SELECTOR) ?? []).find((el) => range.intersectsNode(el));
  return block?.getAttribute(PREVIEW_SEGMENT_ATTR) ?? undefined;
}

export const isEditableTarget = (target: EventTarget | null): boolean =>
  !!target && asElement(target as Node)?.closest('input, textarea, select, [contenteditable]') != null;

/**
 * Owns one foliate `<foliate-view>`: opens preview builds into it, keeping the reading position across rebuilds
 * (by segment id, falling back to the CFI), applies preview-only styles and layout, and reports clicks on segments.
 */
export class PreviewReaderController {
  private view?: View;
  private book?: FoliateBook;
  private styles = '';
  private layout?: PreviewLayout;
  private section = -1;
  private segmentId?: string;
  private cfi?: string;
  private disposed = false;
  private opening: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: PreviewReaderCallbacks,
  ) {}

  /**
   * Opens (or re-opens) a preview build; calls are serialized. The first open starts at the text start, later ones
   * return to the segment (or CFI) that was on screen.
   */
  open(bytes: Uint8Array): Promise<void> {
    const run = this.opening.then(() => this.openNow(bytes));
    this.opening = run.catch(() => undefined);
    return run;
  }

  private async openNow(bytes: Uint8Array): Promise<void> {
    const book = await openPreviewBook(bytes);
    if (this.disposed) return book.destroy();
    const restore = this.section >= 0 ? { section: this.section, segmentId: this.segmentId, cfi: this.cfi } : undefined;
    this.closeBook();
    const view = await this.ensureView();
    this.book = book;
    await view.open(book);
    if (this.disposed) return this.closeBook();
    this.applyLayout();
    view.renderer.setStyles?.(this.styles);
    const selector = restore?.segmentId ? `[${PREVIEW_SEGMENT_ATTR}="${CSS.escape(restore.segmentId)}"]` : undefined;
    if (restore && selector) await view.renderer.goTo({ index: restore.section, anchor: (doc) => doc.querySelector(selector) ?? 0 });
    else await view.init(restore?.cfi ? { lastLocation: restore.cfi } : { showTextStart: true });
  }

  setStyles(css: string): void {
    this.styles = css;
    this.view?.renderer?.setStyles?.(css);
  }

  setLayout(layout: PreviewLayout): void {
    this.layout = layout;
    this.applyLayout();
  }

  get toc(): TocItem[] {
    return this.book?.toc ?? [];
  }

  prev = () => this.view?.goLeft();
  next = () => this.view?.goRight();
  goTo = (target: string) => this.view?.goTo(target);

  search(query: string): AsyncGenerator<SearchEvent> | undefined {
    return this.view?.search({ query });
  }

  clearSearch(): void {
    this.view?.clearSearch();
  }

  dispose(): void {
    this.disposed = true;
    this.closeBook();
    this.view?.remove();
    this.view = undefined;
  }

  private async ensureView(): Promise<View> {
    if (this.view) return this.view;
    await import('./third-party/foliate-js/view.js');
    const view = document.createElement('foliate-view') as View;
    view.setAttribute('data-testid', 'preview-view');
    view.style.display = 'block';
    view.style.width = '100%';
    view.style.height = '100%';
    view.addEventListener('relocate', (e) => this.onRelocate((e as CustomEvent<RelocateDetail>).detail));
    view.addEventListener('load', (e) => this.onSectionLoad((e as CustomEvent<{ doc: Document; index: number }>).detail.doc));
    // Links to other sites open in a new tab without access to this window (a book is untrusted input);
    // foliate's own fallback is cancelled so only http(s) and mailto links ever open.
    view.addEventListener('external-link', (e) => {
      e.preventDefault();
      openExternalLink((e as CustomEvent<{ href_?: string }>).detail?.href_);
    });
    this.host.append(view);
    this.view = view;
    return view;
  }

  private applyLayout(): void {
    const renderer = this.view?.renderer;
    if (!renderer || !this.layout) return;
    const { flow, preset } = this.layout;
    renderer.setAttribute('flow', flow);
    renderer.setAttribute('margin', `${preset.margin}px`);
    renderer.setAttribute('gap', `${preset.gap}%`);
    renderer.setAttribute('max-inline-size', `${preset.maxInlineSize}px`);
    renderer.setAttribute('max-column-count', String(preset.maxColumnCount));
  }

  private onRelocate(detail: RelocateDetail): void {
    this.cfi = detail.cfi;
    if (detail.section) this.section = detail.section.current;
    this.segmentId = segmentAt(detail.range) ?? this.segmentId;
    this.callbacks.onRelocate({ fraction: detail.fraction ?? 0, tocHref: detail.tocItem?.href, tocLabel: detail.tocItem?.label });
  }

  private onSectionLoad(doc: Document): void {
    // foliate's own link handler runs first and cancels clicks on links, so those keep navigating inside the book.
    doc.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (doc.getSelection()?.isCollapsed === false) return;
      const id = asElement(e.target as Node | null)
        ?.closest(SEGMENT_SELECTOR)
        ?.getAttribute(PREVIEW_SEGMENT_ATTR);
      if (id) this.callbacks.onSegmentClick(id);
    });
    doc.addEventListener('keydown', (e) => this.handleKey(e));
  }

  /** Arrow keys turn pages (both inside the book frame and on the page around it). */
  handleKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditableTarget(e.target)) return;
    if (e.key === 'ArrowLeft') void this.prev();
    else if (e.key === 'ArrowRight') void this.next();
    else return;
    e.preventDefault();
  }

  private closeBook(): void {
    try {
      this.view?.close();
    } catch {
      // foliate's renderer throws when closed before its first section rendered: start over with a fresh element.
      this.view?.remove();
      this.view = undefined;
    }
    this.book?.destroy();
    this.book = undefined;
  }
}
