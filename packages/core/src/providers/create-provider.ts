import type { ChatProvider, ProviderPreset, ReasoningLevel } from '../types';
import { createAnthropicProvider } from './anthropic-provider';
import { createOpenAICompatibleProvider } from './openai-compatible-provider';

export interface ProviderOptions {
  /**
   * Reasoning effort for reasoning models. When the endpoint rejects the field (HTTP 400/422), the request is repeated
   * once without it and the field is left out for that endpoint, model and level for the rest of the session.
   */
  reasoning?: ReasoningLevel;
}

/**
 * Creates a chat provider. The API key is only ever sent to `baseURL` (preset default or override).
 * `fetchImpl` defaults to the global fetch and is injectable for tests and custom transports.
 */
export function createProvider(
  preset: ProviderPreset,
  apiKey: string,
  baseURL?: string,
  model?: string,
  fetchImpl?: typeof fetch,
  options: ProviderOptions = {},
): ChatProvider {
  const url = (baseURL ?? preset.baseURL).trim();
  if (!url) throw new Error(`Provider "${preset.label}" needs a base URL`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid base URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Base URL must use http(s): ${url}`);
  const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const common = { baseURL: url, apiKey: apiKey.trim(), model: (model ?? '').trim(), fetchImpl: doFetch as typeof fetch, reasoning: options.reasoning };
  return preset.kind === 'anthropic'
    ? createAnthropicProvider(common)
    : createOpenAICompatibleProvider({ ...common, maxTokensParam: preset.maxTokensParam, reasoningParam: preset.reasoningParam });
}
