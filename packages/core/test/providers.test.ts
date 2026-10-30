import { describe, expect, it, vi } from 'vitest';
import { createProvider, getProviderPreset, PROVIDER_PRESETS, ProviderError } from '../src';

type Captured = { url: string; init: RequestInit };

function mockFetch(responder: (url: string) => Response) {
  const calls: Captured[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return responder(url);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const headersOf = (c: Captured | undefined) => (c?.init.headers ?? {}) as Record<string, string>;
const bodyOf = (c: Captured | undefined) => JSON.parse(String(c?.init.body)) as Record<string, unknown>;

describe('provider presets', () => {
  it('covers the required providers without hardcoded models', () => {
    expect(PROVIDER_PRESETS.map((p) => p.id)).toEqual(['anthropic', 'openai', 'gemini', 'openrouter', 'deepseek', 'custom']);
    for (const p of PROVIDER_PRESETS) expect(p).not.toHaveProperty('model');
    expect(getProviderPreset('gemini').baseURL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  it('requires a base URL for the custom preset', () => {
    expect(() => createProvider(getProviderPreset('custom'), 'k')).toThrow(/base URL/);
    expect(() => createProvider(getProviderPreset('custom'), 'k', 'ftp://x')).toThrow(/http/);
  });
});

describe('OpenAI-compatible adapter', () => {
  it('sends chat completions with bearer auth to the configured endpoint only', async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    const provider = createProvider(getProviderPreset('deepseek'), 'sk-test', undefined, 'deepseek-chat', fetchImpl);
    const res = await provider.chat({ system: 'sys', user: 'usr', maxTokens: 100, temperature: 0.2 });
    expect(res).toEqual({ text: 'hello', usage: { input: 12, output: 3 } });
    expect(calls[0]?.url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0]?.init.method).toBe('POST');
    expect(headersOf(calls[0]).authorization).toBe('Bearer sk-test');
    expect(bodyOf(calls[0])).toEqual({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
      max_tokens: 100,
      temperature: 0.2,
    });
  });

  it('uses max_completion_tokens for OpenAI', async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ choices: [{ message: { content: 'x' } }] }));
    await createProvider(getProviderPreset('openai'), 'k', undefined, 'some-model', fetchImpl).chat({ system: 's', user: 'u', maxTokens: 50 });
    expect(bodyOf(calls[0])).toMatchObject({ max_completion_tokens: 50 });
    expect(bodyOf(calls[0])).not.toHaveProperty('max_tokens');
  });

  it('lists models from /models and parses OpenRouter pricing', async () => {
    const { calls, fetchImpl } = mockFetch(() =>
      json({ data: [{ id: 'z/model', pricing: { prompt: '0.000003', completion: '0.000015' } }, { id: 'a/model' }, { nope: 1 }] }),
    );
    const provider = createProvider(getProviderPreset('openrouter'), 'k', undefined, undefined, fetchImpl);
    expect(await provider.listModels()).toEqual(['a/model', 'z/model']);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/models');
    expect(calls[0]?.init.method).toBe('GET');
    const info = await provider.listModelInfo?.();
    expect(info?.find((m) => m.id === 'z/model')).toEqual({ id: 'z/model', priceInPerM: 3, priceOutPerM: 15 });
  });

  it('maps HTTP errors to ProviderError with Retry-After', async () => {
    const { fetchImpl } = mockFetch(() => json({ error: { message: 'slow down' } }, { status: 429, headers: { 'retry-after': '3' } }));
    const err = await createProvider(getProviderPreset('openai'), 'k', undefined, 'm', fetchImpl)
      .chat({ system: 's', user: 'u' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 3000, retryable: true });
    expect((err as Error).message).toContain('slow down');
  });

  it('maps network failures to retryable errors', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const err = await createProvider(getProviderPreset('gemini'), 'k', undefined, 'm', fetchImpl)
      .chat({ system: 's', user: 'u' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, retryable: true });
  });
});

describe('Anthropic adapter', () => {
  it('calls the Messages API with browser-access header and cached system prompt', async () => {
    const { calls, fetchImpl } = mockFetch(() =>
      json({
        content: [
          { type: 'text', text: 'Xin ' },
          { type: 'text', text: 'chào' },
        ],
        usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 4 },
      }),
    );
    const provider = createProvider(getProviderPreset('anthropic'), 'sk-ant', undefined, 'claude-x', fetchImpl);
    const res = await provider.chat({ system: 'sys', user: 'usr' });
    expect(res).toEqual({ text: 'Xin chào', usage: { input: 100, output: 4 } });
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = headersOf(calls[0]);
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers).not.toHaveProperty('authorization');
    expect(bodyOf(calls[0])).toEqual({
      model: 'claude-x',
      max_tokens: 8192,
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'usr' }],
    });
  });

  it('pages through /v1/models', async () => {
    const { calls, fetchImpl } = mockFetch((url) =>
      url.includes('after_id') ? json({ data: [{ id: 'm3' }], has_more: false }) : json({ data: [{ id: 'm1' }, { id: 'm2' }], has_more: true, last_id: 'm2' }),
    );
    const models = await createProvider(getProviderPreset('anthropic'), 'k', undefined, undefined, fetchImpl).listModels();
    expect(models).toEqual(['m1', 'm2', 'm3']);
    expect(calls.map((c) => c.url)).toEqual(['https://api.anthropic.com/v1/models?limit=1000', 'https://api.anthropic.com/v1/models?limit=1000&after_id=m2']);
  });

  it('honors a base URL override', async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ content: [{ type: 'text', text: 'ok' }] }));
    await createProvider(getProviderPreset('anthropic'), 'k', 'https://proxy.example.com/', 'm', fetchImpl).chat({ system: 's', user: 'u' });
    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/messages');
  });
});
