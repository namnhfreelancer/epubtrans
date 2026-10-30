import type { ProviderPreset } from '../types';

/**
 * Provider presets. Model ids are never hardcoded: they come from the provider's
 * `/models` endpoint, with free-text entry as fallback.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com',
    kind: 'anthropic',
    docsUrl: 'https://docs.claude.com/en/api/messages',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    kind: 'openai-compatible',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    maxTokensParam: 'max_completion_tokens',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'openai-compatible',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    kind: 'openai-compatible',
    docsUrl: 'https://openrouter.ai/docs/api-reference/overview',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    kind: 'openai-compatible',
    docsUrl: 'https://api-docs.deepseek.com/',
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
