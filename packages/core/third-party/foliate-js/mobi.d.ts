/** Type declarations for the vendored foliate-js MOBI/KF8 parser (subset used by @epubtrans/core). */
export interface MobiTocItem {
  label: string;
  href: string;
  subitems?: MobiTocItem[] | null;
}

export interface MobiSection {
  id?: number;
  size?: number;
  linear?: string;
  loadText?: () => Promise<string>;
}

export interface MobiMetadata {
  identifier?: string;
  title?: string;
  author?: string[];
  language?: string | string[];
}

export interface MobiHeaders {
  exth?: { coverOffset?: number; thumbnailOffset?: number } | null;
}

export interface MobiParser {
  headers: MobiHeaders;
  decode(data: ArrayBuffer | Uint8Array): string;
  loadResource(index: number): Promise<ArrayBuffer | Uint8Array>;
}

export interface MobiAnchorTarget {
  index: number;
  anchor: (doc: Document) => Element | null;
}

export interface MobiBook {
  mobi: MobiParser;
  sections: MobiSection[];
  toc?: MobiTocItem[];
  metadata: MobiMetadata;
  /** MOBI6 and KF8. KF8 returns a promise and may resolve to undefined. */
  resolveHref(href: string): MobiAnchorTarget | Promise<MobiAnchorTarget | undefined>;
  /** MOBI6 only: [sectionIndex, anchorId]. */
  splitTOCHref(href: string): [number, unknown];
  /** KF8 only. */
  loadFlow?(index: number): Promise<Uint8Array>;
  /** KF8 only: replaces kindle:flow / kindle:embed URIs via `loadResource`. */
  replaceResources?(markup: string): Promise<string>;
  /** Overridable resource hook; KF8 passes a `kindle:` URI. */
  loadResource?(uri: string): Promise<string>;
}

export interface MobiOptions {
  unzlib: (data: Uint8Array) => Uint8Array;
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
}

export declare class MOBI {
  constructor(options: MobiOptions);
  open(file: Blob): Promise<MobiBook>;
}

export declare function isMOBI(file: Blob): Promise<boolean>;
