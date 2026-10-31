/** Type declarations for the vendored foliate-js EPUB parser (subset used by the epubtrans preview). */
export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[] | null;
}

/** File access for one book; names are archive paths. */
export interface EpubLoader {
  loadText(name: string): Promise<string | null> | string | null;
  loadBlob(name: string, type?: string): Promise<Blob | null> | Blob | null;
  getSize(name: string): number;
}

/** `load` fires per resource before it is loaded; setting `allow` to false skips it. */
export interface LoadEventDetail {
  type: string;
  isScript: boolean;
  allow: boolean | Promise<boolean>;
}

/** `data` fires with each resource's (replaced) content before its blob URL is created; `data` may be rewritten. */
export interface DataEventDetail {
  readonly name: string;
  type: string;
  data: string | Blob | Promise<string | Blob>;
}

export interface FoliateBook {
  toc?: TocItem[];
  dir?: string;
  sections: unknown[];
  /** Resource load and data hooks (`load` and `data` CustomEvents). */
  transformTarget?: EventTarget;
  destroy(): void;
}

export declare class EPUB {
  constructor(loader: EpubLoader);
  init(): Promise<FoliateBook>;
}
