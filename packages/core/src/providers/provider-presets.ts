import type { ProviderPreset } from '../types';

/**
 * Provider presets. Model ids are never hardcoded: they come from the provider's
 * `/models` endpoint, with free-text entry as fallback.
 * Cache price ratios are the provider's documented discount for every model, or the smallest discount across its
 * models (a usage cost is better overstated than understated); providers whose ratio depends on the routed model have
 * none, and cached tokens are then priced like other input unless the book sets a ratio.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com',
    kind: 'anthropic',
    docsUrl: 'https://docs.claude.com/en/api/messages',
    cachedInputRatio: 0.1,
    cacheWriteRatio: 1.25,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    kind: 'openai-compatible',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    maxTokensParam: 'max_completion_tokens',
    cachedInputRatio: 0.5,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'openai-compatible',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    cachedInputRatio: 0.25,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    kind: 'openai-compatible',
    docsUrl: 'https://openrouter.ai/docs/api-reference/overview',
    reasoningParam: 'reasoning',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    kind: 'openai-compatible',
    docsUrl: 'https://api-docs.deepseek.com/',
    cachedInputRatio: 0.26,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseURL: '',
    kind: 'openai-compatible',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
  },
];

export function getProviderPreset(id: string): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown provider preset: ${id}`);
  return preset;
}
