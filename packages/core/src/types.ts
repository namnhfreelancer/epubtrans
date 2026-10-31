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

export type ExportMode = 'bilingual' | 'bilingual-translation-first' | 'translation-only';

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
