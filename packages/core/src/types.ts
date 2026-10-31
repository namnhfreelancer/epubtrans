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

/**
 * Non-blocking flag on a finished segment. `identical`: the translation's text equals the source text (an untranslated
 * echo is likely). The translation is still used by export; the flag only draws the user's attention.
 */
export type SegmentWarning = 'identical';

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
  /** Set by automatic runs after a translation validated; absent on segments without a warning and in older files. */
  warning?: SegmentWarning;
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
  /**
   * Price of cached input tokens as a fraction of `priceInPerM` (0.1 = 90% discount). Absent: the provider's known
   * ratio, or 1 (no discount) when it is unknown.
   */
  cachedInputRatio?: number;
  /** Most segments sent in one request, on top of the token budget (default `DEFAULT_MAX_BATCH_SEGMENTS`). */
  maxSegmentsPerBatch?: number;
  /**
   * A translation identical to its source is flagged only when the text has at least this many letters
   * (default `DEFAULT_IDENTICAL_MIN_LETTERS`); 0 turns the check off.
   */
  identicalMinLetters?: number;
  /** Reasoning effort asked of reasoning models (default: the provider's default). */
  reasoning?: ReasoningLevel;
  /** Word Wise hints for this book; absent in projects that never configured them. */
  wordHints?: WordHintSettings;
  /** Typography of the exported book (written to `epubtrans.css` only); absent means the default look. */
  exportStyle?: ExportStyle;
  /** Opt-in: exports end with a short "Translated with <model> by epubtrans" page. Absent means off. */
  attribution?: boolean;
}

/**
 * Font choice for a block: a generic CSS family (the reader's own font of that kind) or the id of a bundled
 * SIL OFL font, which export embeds in the EPUB. Absent means the book's own font.
 */
export type ExportFontId = 'serif' | 'sans-serif' | 'monospace' | 'literata' | 'noto-serif' | 'be-vietnam-pro' | 'noto-sans';

/** `normal` or `bold`, or a numeric CSS weight (100–900 in steps of 100). */
export type ExportFontWeight = 'normal' | 'bold' | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/**
 * Look of the original text in the bilingual exports (`original` exports keep the book's own look: their text carries no
 * `et-src` class). Every field is optional: absent inherits.
 */
export interface SourceBlockStyle {
  /** `#rrggbb` (validated and normalized; `#rgb` and `rgb(r, g, b)` are accepted as input). */
  color?: string;
  /** 0.2–1; the default look fades the source to 0.55. */
  opacity?: number;
  /** 50–200, percent of the surrounding text size. */
  fontSizePercent?: number;
  italic?: boolean;
  font?: ExportFontId;
}

/** Look of the translated text. Every field is optional: absent inherits. */
export interface TranslationBlockStyle {
  color?: string;
  font?: ExportFontId;
  fontWeight?: ExportFontWeight;
  fontSizePercent?: number;
}

/** Look of Word Wise hints (the ruby/inline choice stays in {@link WordHintSettings.style}). */
export interface HintBlockStyle {
  color?: string;
  /** 30–120, percent of the hinted word's size (default: 55 for ruby glosses, 80 for inline ones). */
  fontSizePercent?: number;
}

/**
 * Per-book typography of the export. Values are validated strictly (colors, numeric ranges, a font allowlist) and
 * only ever emitted into the generated `epubtrans.css`, never as inline styles. No background colors are set, so
 * reader themes (light, sepia, dark) keep working; colors default to inheriting the reader's.
 */
export interface ExportStyle {
  /** The preset this style started from, for display only. */
  preset?: ExportStylePresetId;
  source?: SourceBlockStyle;
  translation?: TranslationBlockStyle;
  /** Vertical space above and below each source and translation block, in em (0–3). */
  blockSpacingEm?: number;
  hint?: HintBlockStyle;
}

export type ExportStylePresetId = 'classic' | 'learner' | 'high-contrast' | 'translation-emphasis' | 'minimal';

/** A named, reusable export style (web: saved in IndexedDB; exported and imported as JSON). */
export interface StyleTemplate {
  name: string;
  style: ExportStyle;
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
  /**
   * Frequency rank of this form (higher is rarer): export shows the occurrence only at levels whose threshold is
   * below it. Absent in files written before per-form ranks; the entry's rank applies then.
   */
  rank?: number;
}

export interface WordHintSense {
  /** Short label chosen by the model; the cache key of a gloss together with the lemma. */
  id: string;
  gloss: string;
}

/** Glosses of one lemma, reused for every occurrence with the same sense. */
export interface WordHintEntry {
  lemma: string;
  /** Frequency rank of the rarest form of the lemma (higher is rarer); the fallback for occurrences without a rank. */
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

/** `default`: send nothing; `low`: ask for little reasoning; `off`: ask to switch reasoning off where the API allows it. */
export type ReasoningLevel = 'default' | 'low' | 'off';

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

export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'fb2' | 'txt' | 'md';

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
  /** Every input token, cached ones included. */
  input: number;
  output: number;
  /** Part of `input` read from the provider's prompt cache (billed at a discount), when the provider reports it. */
  cachedInput?: number;
  /** Part of `input` written to the prompt cache (Anthropic bills it at a premium), when the provider reports it. */
  cacheWriteInput?: number;
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
  /** How the reasoning setting is sent to OpenAI-compatible endpoints: top-level `reasoning_effort` or OpenRouter's `reasoning` object. */
  reasoningParam?: 'reasoning_effort' | 'reasoning';
  /** Cached input price as a fraction of the input price, when the provider documents one for all its models. */
  cachedInputRatio?: number;
  /** Cache-write input price as a fraction of the input price (Anthropic). */
  cacheWriteRatio?: number;
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
