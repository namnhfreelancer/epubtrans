import { perTokenToPerM } from '../pricing/per-token-price';
import type { ChatProvider, ChatRequest, ChatResponse, ModelInfo } from '../types';
import { isRecord, joinUrl, ProviderError, requestJson } from './provider-http';

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
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
      const json = await requestJson(opts.fetchImpl, joinUrl(opts.baseURL, 'chat/completions'), {
        method: 'POST',
        headers: headers(),
        body,
        signal: req.signal,
        secrets: [opts.apiKey],
      });
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
      return {
        text,
        usage: usage ? { input: Number(usage.prompt_tokens) || 0, output: Number(usage.completion_tokens) || 0 } : undefined,
      };
    },
  };
}
