import type { ChatProvider, ChatRequest, ChatResponse } from '../types';
import { isRecord, joinUrl, ProviderError, requestJson } from './provider-http';

export interface AnthropicOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
}

const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

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
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const json = await requestJson(opts.fetchImpl, joinUrl(opts.baseURL, 'v1/messages'), {
        method: 'POST',
        headers: headers(),
        body,
        signal: req.signal,
        secrets: [opts.apiKey],
      });
      const content = isRecord(json) && Array.isArray(json.content) ? json.content : undefined;
      if (!content) throw new ProviderError('Response has no content', 502);
      const text = content.map((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
      const usage = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
      const input = usage
        ? (Number(usage.input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0)
        : 0;
      return { text, usage: usage ? { input, output: Number(usage.output_tokens) || 0 } : undefined };
    },
  };
}
