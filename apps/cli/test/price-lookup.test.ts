import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { createDefaultSettings, loadProjectFile } from '@epubtrans/core';
import { parseArgs } from '../src/args';
import { RUN_FLAGS } from '../src/flag-specs';
import { lookupEstimatePrices } from '../src/price-lookup';
import { run } from '../src/run';
import { createTestIo, startMockProvider, workDirWithFixture } from './test-helpers';

const SECRET = 'sk-test-secret-key';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const CATALOGS: Record<string, unknown> = {
  [OPENROUTER_URL]: { data: [{ id: 'mock-lab/mock-model', pricing: { prompt: '0.000002', completion: '0.00001' } }] },
  [LITELLM_URL]: { 'lite-model': { input_cost_per_token: 4e-7, output_cost_per_token: 1.6e-6, litellm_provider: 'custom', mode: 'chat' } },
};

function catalogFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = CATALOGS[url];
    return body ? Response.json(body) : new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

describe('lookupEstimatePrices', () => {
  const settings = (model: string, extra: object = {}) => ({
    ...createDefaultSettings({ sourceLang: 'en', targetLang: 'vi' }),
    providerId: 'custom',
    model,
    ...extra,
  });

  test('prints the source and matched id and returns the looked-up prices', async () => {
    const { fetchImpl, calls } = catalogFetch();
    const io = createTestIo({ fetch: fetchImpl });
    expect(await lookupEstimatePrices(settings('mock-model'), io, true)).toEqual({ priceInPerM: 2, priceOutPerM: 10 });
    expect(io.stderr).toContain('Prices from OpenRouter (matched: mock-lab/mock-model): $2/M input, $10/M output');
    expect(calls.map((c) => c.url)).toEqual([OPENROUTER_URL]);
  });

  test('falls back to LiteLLM', async () => {
    const io = createTestIo({ fetch: catalogFetch().fetchImpl });
    expect(await lookupEstimatePrices(settings('lite-model'), io, true)).toEqual({ priceInPerM: 0.4, priceOutPerM: 1.6 });
    expect(io.stderr).toContain('Prices from LiteLLM (matched: lite-model)');
  });

  test('keeps user-provided prices and only fills the missing one', async () => {
    const io = createTestIo({ fetch: catalogFetch().fetchImpl });
    expect(await lookupEstimatePrices(settings('mock-model', { priceInPerM: 9 }), io, true)).toEqual({ priceInPerM: 9, priceOutPerM: 10 });
  });

  test('does nothing when both prices are given or the lookup is disabled', async () => {
    const { fetchImpl, calls } = catalogFetch();
    const io = createTestIo({ fetch: fetchImpl });
    expect(await lookupEstimatePrices(settings('mock-model', { priceInPerM: 1, priceOutPerM: 2 }), io, true)).toEqual({});
    expect(await lookupEstimatePrices(settings('mock-model'), io, false)).toEqual({});
    expect(calls).toEqual([]);
  });

  test('reports an unknown model or an unreachable catalog without throwing', async () => {
    const unknown = createTestIo({ fetch: catalogFetch().fetchImpl });
    expect(await lookupEstimatePrices(settings('nope'), unknown, true)).toEqual({});
    expect(unknown.stderr).toContain('No public price found for "nope"');
    const offline = createTestIo();
    expect(await lookupEstimatePrices(settings('mock-model'), offline, true)).toEqual({});
    expect(offline.stderr).toContain('No public price found');
  });

  test('gives up after the timeout instead of stalling the command before the confirmation', async () => {
    // A blackholed host: the request only ends when its signal aborts.
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const io = createTestIo({ fetch: hanging });
    const started = Date.now();
    expect(await lookupEstimatePrices(settings('mock-model'), io, true, 50)).toEqual({});
    expect(Date.now() - started).toBeLessThan(2000);
    expect(io.stderr).toContain('Price lookup timed out');
  });

  test('requests are plain GETs: no Authorization header, no body', async () => {
    const { fetchImpl, calls } = catalogFetch();
    await lookupEstimatePrices(settings('nope'), createTestIo({ fetch: fetchImpl }), true);
    expect(calls.length).toBe(2);
    for (const { init } of calls) {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(Object.keys((init?.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase())).toEqual(['accept']);
    }
  });
});

describe('--no-price-lookup', () => {
  test('is a boolean run flag', () => {
    expect(parseArgs(['--no-price-lookup'], RUN_FLAGS).flags['no-price-lookup']).toBe(true);
    expect(parseArgs([], RUN_FLAGS).flags['no-price-lookup']).toBeUndefined();
  });
});

describe('estimate pricing in translate', () => {
  function setup() {
    const server = startMockProvider();
    const { dir, input } = workDirWithFixture();
    cleanup.push(
      () => server.stop(),
      () => rmSync(dir, { recursive: true, force: true }),
    );
    const args = [
      'translate',
      input,
      '--to',
      'vi',
      '--provider',
      'custom',
      '--base-url',
      server.url,
      '--model',
      'mock-model',
      '--concurrency',
      '1',
      '--yes',
      '--out',
      `${dir}/b.epub`,
    ];
    return { server, input, args, project: `${input}.epubtrans` };
  }

  test('looks up the price for the estimate, never sends the key to the catalogs, and does not save it', async () => {
    const t = setup();
    const { fetchImpl, calls } = catalogFetch();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: SECRET }, fetch: fetchImpl });
    expect(await run(t.args, io)).toBe(0);
    expect(io.stderr).toContain('Prices from OpenRouter (matched: mock-lab/mock-model)');
    expect(io.stderr).toMatch(/Estimated usage: .*about \$/);
    expect(calls.every((c) => !JSON.stringify(c.init ?? {}).includes(SECRET) && !c.url.includes(SECRET))).toBe(true);
    const saved = await loadProjectFile(new Uint8Array(readFileSync(t.project)));
    expect(saved.settings.priceInPerM).toBeUndefined();
    expect(saved.settings.priceOutPerM).toBeUndefined();
  });

  test('--no-price-lookup makes no price request and says the cost is unknown', async () => {
    const t = setup();
    const { fetchImpl, calls } = catalogFetch();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: SECRET }, fetch: fetchImpl });
    expect(await run([...t.args, '--no-price-lookup'], io)).toBe(0);
    expect(calls).toEqual([]);
    expect(io.stderr).toContain('cost unknown');
  });

  test('explicit --price-in/--price-out skip the lookup', async () => {
    const t = setup();
    const { fetchImpl, calls } = catalogFetch();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: SECRET }, fetch: fetchImpl });
    expect(await run([...t.args, '--price-in', '1', '--price-out', '2'], io)).toBe(0);
    expect(calls).toEqual([]);
    expect(io.stderr).toMatch(/about \$/);
  });
});
