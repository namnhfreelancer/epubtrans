/** Type declarations for the vendored foliate-js reader (subset used by the epubtrans preview). */
import type { FoliateBook, TocItem } from './epub.js';

export interface SectionAnchorTarget {
  index: number;
  anchor?: (doc: Document) => Element | Range | number | null;
}

export interface FoliateRenderer extends HTMLElement {
  /** Paginator only (reflowable books); the fixed-layout renderer has no reader styles. */
  setStyles?(styles: string | [string, string]): void;
  goTo(target: SectionAnchorTarget): Promise<void>;
  getContents(): { index: number; doc: Document }[];
}

export interface RelocateDetail {
  /** Reading position in the whole book, 0..1. */
  fraction?: number;
  section?: { current: number; total: number };
  tocItem?: TocItem | null;
  cfi: string;
  range?: Range | null;
}

export interface SearchExcerpt {
  pre: string;
  match: string;
  post: string;
}

export interface SearchMatch {
  cfi: string;
  excerpt: SearchExcerpt;
}

export type SearchEvent = { label: string; subitems: SearchMatch[] } | { progress: number } | 'done';

export interface SearchOptions {
  query: string;
  matchCase?: boolean;
  matchDiacritics?: boolean;
  matchWholeWords?: boolean;
}

export declare class View extends HTMLElement {
  book: FoliateBook;
  renderer: FoliateRenderer;
  lastLocation: RelocateDetail | null;
  open(book: FoliateBook): Promise<void>;
  close(): void;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<SectionAnchorTarget | undefined>;
  prev(): Promise<void>;
  next(): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  search(options: SearchOptions): AsyncGenerator<SearchEvent>;
  clearSearch(): void;
}
