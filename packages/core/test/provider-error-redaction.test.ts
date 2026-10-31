import { describe, expect, it, vi } from 'vitest';
import { createProvider, getProviderPreset, loadProjectFile, ProviderError, REDACTED, saveProjectFile, translateProject } from '../src';
import { makeProject, mockProvider, segment } from './test-helpers';

const KEY = 'zz-fake-gateway-key-4d3c2b1a0987';

/** Fetch stand-in that answers with `body(key)`, where `key` is the credential the adapter actually sent. */
function echoing(status: number, body: (key: string) => string, opts: { throwNetwork?: boolean } = {}) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const sent = headers.authorization?.replace('Bearer ', '') ?? headers['x-api-key'] ?? '';
    if (opts.throwNetwork) throw new TypeError(`fetch failed: headers ${JSON.stringify(headers)}`);
    return new Response(body(sent), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const caught = async (p: Promise<unknown>): Promise<ProviderError> => {
  try {
    await p;
  } catch (err) {
    return err as ProviderError;
  }
  throw new Error('expected a rejection');
};

describe('provider errors never carry the API key', () => {
  const chat = (fetchImpl: typeof fetch, preset = 'custom') =>
    createProvider(getProviderPreset(preset), KEY, 'https://gateway.example/v1', 'm', fetchImpl).chat({ system: 's', user: 'u' });

  it('redacts an exact echo of the key in an OpenAI-style error body', async () => {
    const err = await caught(chat(echoing(401, (k) => JSON.stringify({ error: { message: `Incorrect API key provided: ${k}.` } }))));
    expect(err.status).toBe(401);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain(REDACTED);
  });

  it('redacts a partial echo of the key', async () => {
    const err = await caught(chat(echoing(401, (k) => JSON.stringify({ error: `bad key ${k.slice(0, 14)}...${k.slice(-9)}` }))));
    expect(err.message).not.toContain(KEY.slice(0, 8));
    expect(err.message).not.toContain(KEY.slice(-8));
  });

  it('redacts a Bearer header echoed by a proxy', async () => {
    const err = await caught(chat(echoing(400, (k) => `upstream rejected request with header Authorization: Bearer ${k}`)));
    expect(err.message).not.toContain(KEY);
  });

  it('redacts a query-string echo of the key', async () => {
    const err = await caught(chat(echoing(400, (k) => `bad request: https://upstream.example/v1/chat?key=${encodeURIComponent(k)}&alt=json`)));
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain('alt=json');
  });

  it('redacts the key from a network error that echoes request headers', async () => {
    const err = await caught(chat(echoing(0, () => '', { throwNetwork: true })));
    expect(err.status).toBe(0);
    expect(err.message).not.toContain(KEY);
  });

  it('covers the Anthropic adapter and model listing', async () => {
    const fetchImpl = echoing(401, (k) => JSON.stringify({ type: 'error', error: { message: `invalid x-api-key ${k}` } }));
    const err = await caught(chat(fetchImpl, 'anthropic'));
    expect(err.message).not.toContain(KEY);
    const listErr = await caught(createProvider(getProviderPreset('anthropic'), KEY, 'https://gateway.example', 'm', fetchImpl).listModels());
    expect(listErr.message).not.toContain(KEY);
  });

  it('redacts credential shapes in messages built directly', () => {
    expect(new ProviderError('rejected sk-ant-api03-fake0123456789abcdef', 401).message).toBe(`rejected ${REDACTED}`);
  });

  it('keeps non-secret diagnostics and the classification of the error', async () => {
    const err = await caught(chat(echoing(429, () => JSON.stringify({ error: { message: 'Rate limit reached' } }))));
    expect(err.message).toBe('HTTP 429 from gateway.example: Rate limit reached');
    expect(err.retryable).toBe(true);
  });
});

describe('stored segment errors never carry the API key', () => {
  it('a failed segment keeps a redacted reason, and so does the saved project file', async () => {
    const project = makeProject([[segment('a', 'Hello <b>world</b>.')]]);
    const provider = createProvider(
      getProviderPreset('custom'),
      KEY,
      'https://gateway.example/v1',
      'm',
      echoing(400, (k) => JSON.stringify({ error: { message: `Bad request from key ${k}` } })),
    );
    await translateProject(project, provider, project.settings);
    const seg = project.chapters[0]?.segments[0];
    expect(seg?.status).toBe('error');
    expect(seg?.error).toContain(REDACTED);
    expect(seg?.error).not.toContain(KEY);

    const bytes = await saveProjectFile(project);
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain(KEY);
    const loaded = await loadProjectFile(bytes);
    expect(JSON.stringify(loaded.chapters)).not.toContain(KEY);
  });

  it('a 401 stops the run with a redacted error and the saved project has no key', async () => {
    const project = makeProject([[segment('a', 'Hello.')]]);
    const provider = createProvider(
      getProviderPreset('custom'),
      KEY,
      'https://gateway.example/v1',
      'm',
      echoing(401, (k) => JSON.stringify({ error: { message: `Incorrect API key provided: ${k}` } })),
    );
    const err = await caught(translateProject(project, provider, project.settings));
    expect(err.message).not.toContain(KEY);
    const loaded = await loadProjectFile(await saveProjectFile(project));
    expect(JSON.stringify(loaded)).not.toContain(KEY);
  });

  it('redacts a non-provider failure reason before storing it on the segment', async () => {
    const project = makeProject([[segment('a', 'Hello.')]]);
    const provider = mockProvider(() => {
      throw new Error('transport said: Authorization: Bearer leaked0123456789token');
    });
    await translateProject(project, provider, project.settings);
    expect(project.chapters[0]?.segments[0]?.error).toBe(`transport said: Authorization: ${REDACTED}`);
  });

  it('sanitizes error fields when saving a project that already holds a leaked key', async () => {
    const project = makeProject([[segment('a', 'Hello.')]]);
    const seg = project.chapters[0]?.segments[0];
    if (!seg) throw new Error('fixture changed');
    seg.status = 'error';
    seg.error = 'HTTP 401: Incorrect API key provided: sk-proj-legacy0123456789abcdef';
    const bytes = await saveProjectFile(project);
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('sk-proj-legacy');
    expect(seg.error).toContain('sk-proj-legacy'); // saving does not mutate the in-memory project
  });
});
