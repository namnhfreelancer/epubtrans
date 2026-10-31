/**
 * Public data contracts of @epubtrans/core.
 * Core never touches DOM globals: callers inject a DomEnv
 * (browser natives in the web app, linkedom in the CLI and tests).
 */
export type DomEnv = {
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
};

export type SegmentStatus = 'pending' | 'translated' | 'reviewed' | 'error';

export interface Segment {
  id: string;
  sourceHtml: string;
  sourceText: string;
  translationHtml?: string;
  status: SegmentStatus;
  error?: string;
  /**
   * True when the user wrote or edited `translationHtml` by hand. Automatic runs (`translateProject`, samples)
   * never overwrite such a segment unless asked to; a successful `retranslateSegment` clears the flag.
   */
  userEdited?: boolean;
}

export interface Chapter {
  /** Path of the content document inside `sourceEpub`. */
  href: string;
  title: string;
  segments: Segment[];
}

/** Kind of a glossary term, assigned by glossary generation (or by the user). */
export type GlossaryTermType = 'person' | 'place' | 'organization' | 'term' | 'other';

export interface GlossaryEntry {
  term: string;
  translation: string;
  note?: string;
  /** Absent on hand-written entries and on projects from before typed glossaries. */
  type?: GlossaryTermType;
  /** Occurrences of the term in the source book, when known (set by glossary generation). */
  count?: number;
}

export interface ProjectSettings {
  /** BCP 47 tag or 'auto'. */
  sourceLang: string;
  targetLang: string;
  providerId: string;
  baseURL: string;
  model: string;
  concurrency: number;
  twoPass: boolean;
  guideline: string;
  glossary: GlossaryEntry[];
  /** USD per 1M input tokens. */
  priceInPerM?: number;
  /** USD per 1M output tokens. */
  priceOutPerM?: number;
  /** Word Wise hints for this book; absent in projects that never configured them. */
  wordHints?: WordHintSettings;
}

/** How a hint is written into the exported book. EPUB 2 packages always get `inline` (ruby is invalid there). */
export type WordHintStyle = 'ruby' | 'inline';

/** Per-book Word Wise options: hints are short glosses over difficult words of the ORIGINAL text. */
export interface WordHintSettings {
  /** Exported in the bilingual modes and in `original` (hints on the source text); never in `translation-only`. */
  enabled: boolean;
  /** 1 (fewest hints: only the rarest words) … 5 (most hints), mapped to word frequency ranks. */
  level: number;
  /** Language the glosses are written in; absent means the book's target language. */
  glossLang?: string;
  style: WordHintStyle;
  /** At most this many hints per paragraph, rarest words first (0: no limit). Applied at export. */
  maxPerParagraph: number;
  /** Only the first N occurrences of a word sense in each chapter get a hint (0: every occurrence). Applied at export. */
  perChapter: number;
}

/** One place where a hinted word occurs: the `nth` (0-based) occurrence of exactly `word` among the words of a segment. */
export interface WordHintOccurrence {
  segmentId: string;
  word: string;
  nth: number;
  /** Id of the sense of the lemma used here (see `WordHintEntry.senses`). */
  sense: string;
}

export interface WordHintSense {
  /** Short label chosen by the model; the cache key of a gloss together with the lemma. */
  id: string;
  gloss: string;
}

/** Glosses of one lemma, reused for every occurrence with the same sense. */
export interface WordHintEntry {
  lemma: string;
  /** Frequency rank of the word (higher is rarer); export filters by the configured level without new requests. */
  rank: number;
  /** Empty when the model judged the word not worth a hint (a name, a non-word); such a lemma is never sent again. */
  senses: WordHintSense[];
  occurrences: WordHintOccurrence[];
}

/** Generated hints of a book. Entries are written for one language pair; another pair starts over. */
export interface WordHints {
  sourceLang: string;
  glossLang: string;
  entries: WordHintEntry[];
}

export interface Project {
  schemaVersion: 1;
  id: string;
  title: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  chapters: Chapter[];
  /** Normalized EPUB package; its documents carry `data-et-id` segment markers. */
  sourceEpub: Uint8Array;
  /** The passages picked by the last sample translation; absent in projects that never ran one. */
  lastSample?: SampleSelection;
  /** Generated Word Wise glosses; absent until hints were generated. */
  wordHints?: WordHints;
}

/** A contiguous run of segments of one chapter, translated as a quality check before the full run. */
export interface SamplePassage {
  chapterHref: string;
  chapterTitle: string;
  segmentIds: string[];
}

export interface SampleSelection {
  /** Seed of the pseudo-random generator that picked the passages; the same seed picks the same passages. */
  seed: number;
  passages: SamplePassage[];
}

export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'fb2';

/** `original`: the source text only (with Word Wise hints when enabled), no translation needed. */
export type ExportMode = 'bilingual' | 'bilingual-translation-first' | 'translation-only' | 'original';

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface ChatResponse {
  text: string;
  usage?: TokenUsage;
}

export interface ModelInfo {
  id: string;
  /** USD per 1M input tokens, when the endpoint publishes pricing (OpenRouter). */
  priceInPerM?: number;
  priceOutPerM?: number;
}

export interface ChatProvider {
  listModels(signal?: AbortSignal): Promise<string[]>;
  /** Optional richer listing; adapters that know pricing fill it in. */
  listModelInfo?(signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export type ProviderKind = 'openai-compatible' | 'anthropic';

export interface ProviderPreset {
  id: string;
  label: string;
  /** Empty for the custom preset: the user must supply a base URL. */
  baseURL: string;
  kind: ProviderKind;
  docsUrl: string;
  /** Name of the output-token limit field for OpenAI-compatible endpoints. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
}

export type TranslationPhase = 'translate' | 'review';

export interface TranslationProgress {
  phase: TranslationPhase;
  /** Segments finished (success or error) in this phase. */
  done: number;
  total: number;
  usage: TokenUsage;
}

export interface TranslateOptions {
  onProgress?: (progress: TranslationProgress) => void;
  onSegment?: (segment: Segment, chapter: Chapter) => void;
  signal?: AbortSignal;
  /** Also translate and review segments the user edited by hand (`userEdited`); by default they are left alone. */
  overwriteUserEdited?: boolean;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  usd?: number;
}
