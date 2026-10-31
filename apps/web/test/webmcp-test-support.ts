import { createDefaultSettings, type Project } from '@epubtrans/core';
import { expect } from 'vitest';
import { translate } from '../src/i18n/translate-message';
import { apiKeys } from '../src/lib/api-key-store';
import type { Route } from '../src/lib/hash-route';
import { providerConfig } from '../src/lib/provider-config-store';
import { registerWebMcpTools } from '../src/webmcp/model-context-adapter';
import type { ToolContext } from '../src/webmcp/tool-context';
import { MAX_OUTPUT_CHARS } from '../src/webmcp/tool-result';
import { createWebMcpTools } from '../src/webmcp/webmcp-tools';
import type { ModelContext, ModelContextTool, RegisterToolOptions } from '../src/webmcp/webmcp-types';

/** A planted key: no tool output or error may ever contain it. */
export const SENTINEL_KEY = 'sk-SENTINEL-webmcp-7f3a9c21d4';
export const MOCK_BASE = 'https://mock-provider.test/v1';

/** A `document.modelContext` stand-in that records registrations and unregisters on abort, like the native API. */
export function fakeModelContext() {
  const tools = new Map<string, ModelContextTool>();
  const context: ModelContext = {
    registerTool(tool: ModelContextTool, options?: RegisterToolOptions) {
      if (tools.has(tool.name)) return Promise.reject(new DOMException(`Duplicate tool ${tool.name}`, 'InvalidStateError'));
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      return Promise.resolve();
    },
  };
  return { context, tools };
}

export interface FakeProviderState {
  chatRequests: number;
  segmentIds: string[];
  /** Segment ids answered with markup the validator rejects, so they end in `error`. */
  invalidIds: Set<string>;
  /** Makes /models fail with an error that echoes the API key, like some misbehaving endpoints do. */
  echoKeyOnModels: boolean;
  /** Holds every chat answer until released (for "a job is running" states). */
  gate?: Promise<void>;
  urlFetches: string[];
  /** Answers for non-provider URLs (book downloads); undefined: a network/CORS failure. */
  urls: Map<string, () => Response>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake global fetch: an OpenAI-compatible provider at MOCK_BASE, price catalogs answering 404, plus planted URLs. */
export function fakeFetch(state: FakeProviderState): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${MOCK_BASE}/models`)) {
      if (state.echoKeyOnModels) return json(401, { error: { message: `Incorrect API key provided: ${SENTINEL_KEY}` } });
      return json(200, { data: [{ id: 'mock-model' }, { id: 'mock-model-pro' }, { id: 'other-model' }] });
    }
    if (url.startsWith(`${MOCK_BASE}/chat/completions`)) {
      state.chatRequests++;
      if (state.gate) await state.gate;
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
      let content: string;
      if (system.includes('terminology editor')) content = JSON.stringify({ entries: [{ term: 'Gulliver', translation: 'Gu-li-vơ', type: 'person' }] });
      else if (system.includes('preparing a book translation')) content = JSON.stringify({ sections: { genre: '- Mock genre.' } });
      else {
        const { segments } = JSON.parse(user) as { segments: { id: string; html?: string; draft?: string }[] };
        state.segmentIds.push(...segments.map((s) => s.id));
        content = JSON.stringify({
          segments: segments.map((s) => ({ id: s.id, html: s.draft ?? (state.invalidIds.has(s.id) ? '<script>x()</script>' : `Dịch ${s.html ?? ''}`) })),
        });
      }
      return json(200, { choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    }
    state.urlFetches.push(url);
    const answer = state.urls.get(url);
    if (answer) return answer();
    if (/openrouter\.ai|githubusercontent\.com/.test(url)) return json(404, {});
    throw new TypeError('Failed to fetch');
  };
}

export function newProviderState(): FakeProviderState {
  return { chatRequests: 0, segmentIds: [], invalidIds: new Set(), echoKeyOnModels: false, urlFetches: [], urls: new Map() };
}

/** Configures the custom preset against the fake provider, with the sentinel key in memory. */
export function configureFakeProvider(): void {
  providerConfig.selectProvider('custom');
  providerConfig.updateProfile('custom', { baseURL: MOCK_BASE, model: 'mock-model' });
  apiKeys.setKey('custom', SENTINEL_KEY, false);
}

export function makeProject(id: string, segments = 3): Project {
  const now = new Date('2026-10-31T00:00:00Z').toISOString();
  return {
    schemaVersion: 1,
    id,
    title: `Book ${id}`,
    author: 'Jonathan Swift',
    createdAt: now,
    updatedAt: now,
    settings: { ...createDefaultSettings({ targetLang: 'vi', concurrency: 1, model: 'mock-model' }), priceInPerM: 1, priceOutPerM: 2 },
    sourceEpub: new Uint8Array([0x50, 0x4b, 3, 4]),
    chapters: [
      {
        href: 'ch1.xhtml',
        title: 'Chapter 1',
        segments: Array.from({ length: segments }, (_, i) => ({
          id: `s${i + 1}`,
          sourceHtml: `<b>Text</b> number ${i + 1} about Gulliver &amp; his travels.`,
          sourceText: `Text number ${i + 1} about Gulliver & his travels.`,
          status: 'pending' as const,
        })),
      },
    ],
  };
}

export interface ToolHarness {
  call(name: string, input?: unknown): Promise<Record<string, unknown>>;
  /** Every raw output so far, for the key-leak sweep. */
  outputs: string[];
  confirms: string[];
  /** Answers of the next confirm dialogs (default: accept). */
  confirmAnswers: boolean[];
  navigations: Route[];
  downloads: { fileName: string; bytes: number }[];
  tools: Map<string, ModelContextTool>;
  unregister(): void;
}

/** Registers every tool on a fake model context, with a fake browser context, and calls them like an agent. */
export function toolHarness(opts: { fetch: typeof fetch; secrets?: () => string[] }): ToolHarness {
  const harness: Omit<ToolHarness, 'call' | 'tools' | 'unregister'> = { outputs: [], confirms: [], confirmAnswers: [], navigations: [], downloads: [] };
  const ctx: ToolContext = {
    t: (key, params) => translate('en', key, params),
    locale: () => 'en',
    confirm: (message) => {
      harness.confirms.push(message);
      return harness.confirmAnswers.shift() ?? true;
    },
    navigate: (route) => harness.navigations.push(route),
    download: (bytes, fileName) => harness.downloads.push({ fileName, bytes: bytes.byteLength }),
    domEnv: () => {
      throw new Error('No DOM in unit tests');
    },
    fetch: (input, init) => opts.fetch(input, init),
    secrets: opts.secrets ?? (() => Object.values(apiKeys.store.get().keys).filter(Boolean)),
  };
  const { context, tools } = fakeModelContext();
  const unregister = registerWebMcpTools(createWebMcpTools(ctx), context);
  return {
    ...harness,
    tools,
    unregister,
    async call(name, input = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`tool ${name} is not registered`);
      const raw = await tool.execute(input, { signal: new AbortController().signal });
      harness.outputs.push(raw);
      expect(typeof raw).toBe('string');
      expect(raw.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(typeof parsed.ok).toBe('boolean');
      return parsed;
    },
  };
}

/** Holds the project's job lock like another tab running a job, until the returned function is called. */
export async function holdLockElsewhere(lockName: string): Promise<() => Promise<void>> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const done = navigator.locks.request(lockName, async () => {
    acquired();
    await held;
  });
  await ready;
  return async () => {
    release();
    await done;
  };
}

/** Waits until `check` passes (polling), for background jobs. */
export async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}
