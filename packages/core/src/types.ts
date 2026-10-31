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
}

export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'fb2';

export type ExportMode = 'bilingual' | 'bilingual-translation-first' | 'translation-only';

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
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  usd?: number;
}
