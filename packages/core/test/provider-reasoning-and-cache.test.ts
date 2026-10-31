import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachePriceRatios, createProvider, getProviderPreset, translateProject, usageCostUsd } from '../src';
import { parseOpenAIUsage } from '../src/providers/openai-compatible-provider';
import { clearReasoningRejections } from '../src/providers/reasoning-fallback';
import { makeProject, segment } from './test-helpers';

type Call = { url: string; body: Record<string, unknown> };

function recordingFetch(respond: (body: Record<string, unknown>, n: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    return respond(body, calls.length);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const badRequest = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 });
const openAiAnswer = (content: string, usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 2 }) =>
  ok({ choices: [{ message: { content } }], usage });

afterEach(() => clearReasoningRejections());

describe('reasoning setting', () => {
  it('maps low/off to reasoning_effort for OpenAI-compatible presets and to the reasoning object for OpenRouter', async () => {
    const { calls, fetchImpl } = recordingFetch(() => openAiAnswer('hi'));
    await createProvider(getProviderPreset('openai'), 'k', undefined, 'gpt-x', fetchImpl, { reasoning: 'low' }).chat({ system: 's', user: 'u' });
    await createProvider(getProviderPreset('gemini'), 'k', undefined, 'gem', fetchImpl, { reasoning: 'off' }).chat({ system: 's', user: 'u' });
    await createProvider(getProviderPreset('openrouter'), 'k', undefined, 'or', fetchImpl, { reasoning: 'off' }).chat({ system: 's', user: 'u' });
    await createProvider(getProviderPreset('openai'), 'k', undefined, 'gpt-x', fetchImpl, { reasoning: 'default' }).chat({ system: 's', user: 'u' });
    expect(calls[0]?.body.reasoning_effort).toBe('low');
    expect(calls[1]?.body.reasoning_effort).toBe('none');
    expect(calls[2]?.body.reasoning).toEqual({ effort: 'none' });
    expect(calls[2]?.body).not.toHaveProperty('reasoning_effort');
    expect(calls[3]?.body).not.toHaveProperty('reasoning_effort');
  });

  it('maps off to disabled thinking and low to the smallest thinking budget for Anthropic', async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      ok({
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: 'Xin chào' },
        ],
      }),
    );
    await createProvider(getProviderPreset('anthropic'), 'k', undefined, 'claude', fetchImpl, { reasoning: 'off' }).chat({
      system: 's',
      user: 'u',
      maxTokens: 500,
    });
    const res = await createProvider(getProviderPreset('anthropic'), 'k', undefined, 'claude', fetchImpl, { reasoning: 'low' }).chat({
      system: 's',
      user: 'u',
      maxTokens: 500,
      temperature: 0.3,
    });
    expect(calls[0]?.body.thinking).toEqual({ type: 'disabled' });
    expect(calls[1]?.body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(calls[1]?.body.max_tokens).toBe(1524);
    expect(calls[1]?.body).not.toHaveProperty('temperature');
    expect(res.text).toBe('Xin chào');
  });

  it('retries once without a rejected field and leaves it out for the rest of the session', async () => {
    const { calls, fetchImpl } = recordingFetch((body) =>
      'reasoning_effort' in body ? badRequest('Unrecognized request argument: reasoning_effort') : openAiAnswer('hi'),
    );
    const provider = createProvider(getProviderPreset('custom'), '', 'https://llm.example/v1', 'local', fetchImpl, { reasoning: 'low' });
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect(calls.map((c) => 'reasoning_effort' in c.body)).toEqual([true, false, false]);
    // Another provider instance for the same endpoint and model (the next run of the session) remembers it too.
    await createProvider(getProviderPreset('custom'), '', 'https://llm.example/v1', 'local', fetchImpl, { reasoning: 'low' }).chat({ system: 's', user: 'u' });
    expect(calls).toHaveLength(4);
  });

  it('propagates the error and remembers nothing when the request also fails without the field', async () => {
    const { calls, fetchImpl } = recordingFetch(() => badRequest('content too long'));
    const provider = createProvider(getProviderPreset('openai'), 'k', undefined, 'gpt-x', fetchImpl, { reasoning: 'off' });
    await expect(provider.chat({ system: 's', user: 'u' })).rejects.toMatchObject({ status: 400 });
    await expect(provider.chat({ system: 's', user: 'u' })).rejects.toMatchObject({ status: 400 });
    expect(calls.map((c) => c.body.reasoning_effort ?? null)).toEqual(['none', 'minimal', null, 'none', 'minimal', null]);
  });

  it('tries minimal effort when an endpoint rejects none, and remembers it', async () => {
    const { calls, fetchImpl } = recordingFetch((body) =>
      body.reasoning_effort === 'none' ? badRequest("Unsupported value: 'reasoning_effort' does not support 'none'") : openAiAnswer('hi'),
    );
    const provider = createProvider(getProviderPreset('openai'), 'k', undefined, 'gpt-5', fetchImpl, { reasoning: 'off' });
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect(calls.map((c) => c.body.reasoning_effort)).toEqual(['none', 'minimal', 'minimal']);
    // OpenRouter's reasoning object steps down the same way.
    const openRouter = recordingFetch((body) =>
      (body.reasoning as { effort?: string } | undefined)?.effort === 'none' ? badRequest('effort none not supported') : openAiAnswer('hi'),
    );
    await createProvider(getProviderPreset('openrouter'), 'k', undefined, 'or', openRouter.fetchImpl, { reasoning: 'off' }).chat({ system: 's', user: 'u' });
    expect(openRouter.calls.map((c) => c.body.reasoning)).toEqual([{ effort: 'none' }, { effort: 'minimal' }]);
  });

  it('drops the field after minimal is rejected too, and remembers that', async () => {
    const { calls, fetchImpl } = recordingFetch((body) => ('reasoning_effort' in body ? badRequest('Unrecognized request argument') : openAiAnswer('hi')));
    const provider = createProvider(getProviderPreset('custom'), '', 'https://llm.example/v1', 'local', fetchImpl, { reasoning: 'off' });
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect(calls.map((c) => c.body.reasoning_effort ?? null)).toEqual(['none', 'minimal', null, null]);
  });

  it.each([401, 403, 404, 429, 500, 503])('never retries without the field on a %i answer, and remembers nothing', async (status) => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ error: { message: 'nope' } }), { status }));
    const provider = createProvider(getProviderPreset('custom'), '', 'https://llm.example/v1', `local-${status}`, fetchImpl, { reasoning: 'low' });
    await expect(provider.chat({ system: 's', user: 'u' })).rejects.toMatchObject({ status });
    await expect(provider.chat({ system: 's', user: 'u' })).rejects.toMatchObject({ status });
    expect(calls.map((c) => 'reasoning_effort' in c.body)).toEqual([true, true]);
  });

  it('falls back on a 422 answer like on a 400', async () => {
    const { calls, fetchImpl } = recordingFetch((body) =>
      'reasoning_effort' in body ? new Response(JSON.stringify({ detail: 'extra fields not permitted' }), { status: 422 }) : openAiAnswer('hi'),
    );
    const provider = createProvider(getProviderPreset('custom'), '', 'https://llm.example/v1', 'strict', fetchImpl, { reasoning: 'low' });
    expect((await provider.chat({ system: 's', user: 'u' })).text).toBe('hi');
    expect(calls.map((c) => 'reasoning_effort' in c.body)).toEqual([true, false]);
  });

  it('never lets a rejected reasoning field count toward the five consecutive client errors that stop a run', async () => {
    const { calls, fetchImpl } = recordingFetch((body) => {
      if ('reasoning_effort' in body) return badRequest('reasoning_effort is not supported');
      const user = JSON.parse(String((body.messages as { content: string }[])[1]?.content)) as { segments: { id: string; html: string }[] };
      return openAiAnswer(JSON.stringify({ segments: user.segments.map((s) => ({ id: s.id, html: `[vi] ${s.html}` })) }));
    });
    const segments = Array.from({ length: 8 }, (_, i) => segment(`c0-${i}`, `Sentence number ${i}.`));
    const project = makeProject([segments]);
    const settings = { ...project.settings, providerId: 'openai', maxSegmentsPerBatch: 1, concurrency: 1 };
    const provider = createProvider(getProviderPreset('openai'), 'k', 'https://other.example/v1', 'gpt-x', fetchImpl, { reasoning: 'low' });
    await translateProject(project, provider, settings);
    expect(segments.every((s) => s.status === 'translated')).toBe(true);
    expect(calls.filter((c) => 'reasoning_effort' in c.body)).toHaveLength(1);
  });
});

describe('cached input tokens', () => {
  it('reads cached tokens from OpenAI-compatible and DeepSeek usage', async () => {
    const { fetchImpl } = recordingFetch((_, n) =>
      n === 1
        ? openAiAnswer('a', { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 800 } })
        : openAiAnswer('b', { prompt_tokens: 500, completion_tokens: 5, prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 200 }),
    );
    const provider = createProvider(getProviderPreset('openai'), 'k', undefined, 'gpt-x', fetchImpl);
    expect((await provider.chat({ system: 's', user: 'u' })).usage).toEqual({ input: 1000, output: 10, cachedInput: 800 });
    expect((await provider.chat({ system: 's', user: 'u' })).usage).toEqual({ input: 500, output: 5, cachedInput: 300 });
  });

  it('reads cache writes from OpenRouter usage, never more than the uncached prompt', () => {
    expect(parseOpenAIUsage({ prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 900 } })).toEqual({
      input: 1000,
      output: 5,
      cacheWriteInput: 900,
    });
    expect(parseOpenAIUsage({ prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 900 } })).toEqual({
      input: 1000,
      output: 5,
      cachedInput: 800,
      cacheWriteInput: 200,
    });
  });

  it('reads cache reads and writes from Anthropic usage', async () => {
    const { fetchImpl } = recordingFetch(() =>
      ok({
        content: [{ type: 'text', text: 'x' }],
        usage: { input_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 100, output_tokens: 7 },
      }),
    );
    const res = await createProvider(getProviderPreset('anthropic'), 'k', undefined, 'claude', fetchImpl).chat({ system: 's', user: 'u' });
    expect(res.usage).toEqual({ input: 1050, output: 7, cachedInput: 900, cacheWriteInput: 100 });
  });

  it('prices cached tokens with the book ratio, else the provider ratio, else like other input', () => {
    const usage = { input: 1_000_000, output: 0, cachedInput: 800_000, cacheWriteInput: 100_000 };
    expect(cachePriceRatios({ providerId: 'anthropic' })).toEqual({ read: 0.1, write: 1.25 });
    expect(cachePriceRatios({ providerId: 'openrouter' })).toEqual({ read: 1, write: 1 });
    expect(cachePriceRatios({ providerId: 'openrouter', cachedInputRatio: 0.25 }).read).toBe(0.25);
    // 100k plain + 800k × 0.1 + 100k × 1.25 = 305k input-priced tokens at $10/M.
    expect(usageCostUsd(usage, { providerId: 'anthropic', priceInPerM: 10, priceOutPerM: 50 })).toBeCloseTo(3.05);
    expect(usageCostUsd({ input: 1_000_000, output: 0, cachedInput: 500_000 }, { providerId: 'custom', priceInPerM: 2, priceOutPerM: 8 })).toBeCloseTo(2);
    expect(usageCostUsd(usage, { providerId: 'anthropic', priceInPerM: 10 })).toBeUndefined();
  });

  it('adds cached counts to the run usage reported in progress', async () => {
    const { fetchImpl } = recordingFetch((body) => {
      const user = JSON.parse(String((body.messages as { content: string }[])[1]?.content)) as { segments: { id: string; html: string }[] };
      return openAiAnswer(JSON.stringify({ segments: user.segments.map((s) => ({ id: s.id, html: `[vi] ${s.html}` })) }), {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 60 },
      });
    });
    const project = makeProject([[segment('c0-0', 'One sentence here.'), segment('c0-1', 'Another sentence.')]]);
    const seen: unknown[] = [];
    const provider = createProvider(getProviderPreset('openai'), 'k', undefined, 'gpt-x', fetchImpl);
    await translateProject(project, provider, { ...project.settings, maxSegmentsPerBatch: 1, concurrency: 1 }, { onProgress: (p) => seen.push(p.usage) });
    expect(seen.at(-1)).toEqual({ input: 200, output: 40, cachedInput: 120 });
  });
});
