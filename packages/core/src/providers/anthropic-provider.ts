import type { ChatProvider, ChatRequest, ChatResponse, ReasoningLevel, TokenUsage } from '../types';
import { isRecord, joinUrl, ProviderError, requestJson } from './provider-http';
import { withReasoningFallback } from './reasoning-fallback';

export interface AnthropicOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
  reasoning?: ReasoningLevel;
}

const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;
/** Smallest extended-thinking budget the Messages API accepts; `low` asks for exactly that. */
const LOW_THINKING_BUDGET = 1024;

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Usage of a Messages answer: `input_tokens` excludes cache reads and writes, so all three are summed into `input`. */
export function parseAnthropicUsage(usage: Record<string, unknown>): TokenUsage {
  const cached = count(usage.cache_read_input_tokens);
  const written = count(usage.cache_creation_input_tokens);
  return {
    input: count(usage.input_tokens) + cached + written,
    output: count(usage.output_tokens),
    ...(cached > 0 ? { cachedInput: cached } : {}),
    ...(written > 0 ? { cacheWriteInput: written } : {}),
  };
}

/**
 * The request body for a reasoning level: `off` disables extended thinking explicitly, `low` enables it with the smallest
 * budget (thinking tokens count toward `max_tokens`, and a custom temperature is not allowed with thinking).
 */
function withThinking(body: Record<string, unknown>, level: ReasoningLevel | undefined, maxTokens: number): Record<string, unknown> {
  if (level === 'off') return { ...body, thinking: { type: 'disabled' } };
  if (level !== 'low') return body;
  const { temperature: _notAllowed, ...rest } = body;
  return { ...rest, max_tokens: maxTokens + LOW_THINKING_BUDGET, thinking: { type: 'enabled', budget_tokens: LOW_THINKING_BUDGET } };
}

/**
 * Native Anthropic Messages adapter. Browser CORS is enabled by the
 * `anthropic-dangerous-direct-browser-access` header; the system prompt is marked for prompt caching.
 */
export function createAnthropicProvider(opts: AnthropicOptions): ChatProvider {
  const headers = (): Record<string, string> => ({
    'x-api-key': opts.apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  });

  return {
    async listModels(signal?: AbortSignal): Promise<string[]> {
      const ids: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const query = `v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
        const json = await requestJson(opts.fetchImpl, joinUrl(opts.baseURL, query), { method: 'GET', headers: headers(), signal, secrets: [opts.apiKey] });
        const data = isRecord(json) && Array.isArray(json.data) ? json.data : [];
        for (const m of data) if (isRecord(m) && typeof m.id === 'string') ids.push(m.id);
        if (!isRecord(json) || json.has_more !== true || typeof json.last_id !== 'string') break;
        after = json.last_id;
      }
      return ids;
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (!opts.model) throw new ProviderError('No model selected', 400);
      const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const url = joinUrl(opts.baseURL, 'v1/messages');
      const json = await withReasoningFallback(`${url}\u0000${opts.model}`, opts.reasoning, (withField) =>
        requestJson(opts.fetchImpl, url, {
          method: 'POST',
          headers: headers(),
          body: withField ? withThinking(body, opts.reasoning, maxTokens) : body,
          signal: req.signal,
          secrets: [opts.apiKey],
        }),
      );
      const content = isRecord(json) && Array.isArray(json.content) ? json.content : undefined;
      if (!content) throw new ProviderError('Response has no content', 502);
      // Thinking blocks (type "thinking") are skipped: only the text answer matters.
      const text = content.map((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
      const usage = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
      return { text, usage: usage ? parseAnthropicUsage(usage) : undefined };
    },
  };
}
