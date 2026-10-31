import { perTokenToPerM } from '../pricing/per-token-price';
import type { ChatProvider, ChatRequest, ChatResponse, ModelInfo, ReasoningLevel, TokenUsage } from '../types';
import { isRecord, joinUrl, ProviderError, requestJson } from './provider-http';
import { withReasoningFallback } from './reasoning-fallback';

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  reasoningParam?: 'reasoning_effort' | 'reasoning';
  reasoning?: ReasoningLevel;
}

/**
 * Reasoning field variants for `low`/`off`, most faithful first: top-level `reasoning_effort` (OpenAI, Gemini, most
 * servers) or OpenRouter's object. "Off" asks for `none`, then `minimal` for models that cannot switch reasoning off
 * (gpt-5, o-series, Gemini 2.5 Pro): the least effort they accept is closer to the user's choice than their default.
 */
function reasoningVariants(param: OpenAICompatibleOptions['reasoningParam'], level: ReasoningLevel | undefined): Record<string, unknown>[] {
  const efforts = level === 'low' ? ['low'] : level === 'off' ? ['none', 'minimal'] : [];
  return efforts.map((effort) => (param === 'reasoning' ? { reasoning: { effort } } : { reasoning_effort: effort }));
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * Usage of a Chat Completions answer; cached prompt tokens come from `prompt_tokens_details` (DeepSeek:
 * `prompt_cache_hit_tokens`), and prompt tokens written to the cache from `cache_write_tokens` (OpenRouter, for models
 * with explicit caching). `prompt_tokens` counts both.
 */
export function parseOpenAIUsage(usage: Record<string, unknown>): TokenUsage {
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
  const input = count(usage.prompt_tokens);
  const cached = Math.min(input, count(details?.cached_tokens) || count(usage.prompt_cache_hit_tokens));
  const written = Math.min(input - cached, count(details?.cache_write_tokens));
  return {
    input,
    output: count(usage.completion_tokens),
    ...(cached > 0 ? { cachedInput: cached } : {}),
    ...(written > 0 ? { cacheWriteInput: written } : {}),
  };
}

/** Chat Completions adapter for OpenAI and compatible endpoints (Gemini, OpenRouter, DeepSeek, custom). */
export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): ChatProvider {
  const headers = (): Record<string, string> => (opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {});

  const listModelInfo = async (signal?: AbortSignal): Promise<ModelInfo[]> => {
    const json = await requestJson(opts.fetchImpl, joinUrl(opts.baseURL, 'models'), { method: 'GET', headers: headers(), signal, secrets: [opts.apiKey] });
    const data = isRecord(json) && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    const models: ModelInfo[] = [];
    for (const item of data) {
      if (!isRecord(item) || typeof item.id !== 'string') continue;
      const info: ModelInfo = { id: item.id };
      const pricing = isRecord(item.pricing) ? item.pricing : undefined;
      const priceInPerM = perTokenToPerM(pricing?.prompt);
      const priceOutPerM = perTokenToPerM(pricing?.completion);
      if (priceInPerM !== undefined) info.priceInPerM = priceInPerM;
      if (priceOutPerM !== undefined) info.priceOutPerM = priceOutPerM;
      models.push(info);
    }
    return models.sort((a, b) => a.id.localeCompare(b.id));
  };

  return {
    listModelInfo,
    listModels: async (signal) => (await listModelInfo(signal)).map((m) => m.id),
    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (!opts.model) throw new ProviderError('No model selected', 400);
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      };
      if (req.maxTokens !== undefined) body[opts.maxTokensParam ?? 'max_tokens'] = req.maxTokens;
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const url = joinUrl(opts.baseURL, 'chat/completions');
      const variants = reasoningVariants(opts.reasoningParam, opts.reasoning);
      const json = await withReasoningFallback(`${url}\u0000${opts.model}\u0000${opts.reasoning}`, variants, (field) =>
        requestJson(opts.fetchImpl, url, {
          method: 'POST',
          headers: headers(),
          body: field ? { ...body, ...field } : body,
          signal: req.signal,
          secrets: [opts.apiKey],
        }),
      );
      const choice = isRecord(json) && Array.isArray(json.choices) ? json.choices[0] : undefined;
      const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
      const content = message?.content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((p) => (isRecord(p) && typeof p.text === 'string' ? p.text : '')).join('')
            : undefined;
      if (text === undefined) throw new ProviderError('Response has no message content', 502);
      const usage = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
      return { text, usage: usage ? parseOpenAIUsage(usage) : undefined };
    },
  };
}
