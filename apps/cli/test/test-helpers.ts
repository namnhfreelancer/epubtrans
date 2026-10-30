import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Io } from '../src/io';

export const FIXTURE_DIR = join(import.meta.dir, '../../../packages/core/test/fixtures');

export interface TestIo extends Io {
  stdout: string;
  stderr: string;
}

export function createTestIo(opts: { env?: Record<string, string | undefined>; signal?: AbortSignal; interactive?: boolean; stdin?: string } = {}): TestIo {
  const io: TestIo = {
    stdout: '',
    stderr: '',
    out: (text) => {
      io.stdout += text;
    },
    err: (text) => {
      io.stderr += text;
    },
    env: opts.env ?? {},
    interactive: opts.interactive ?? false,
    progressInPlace: false,
    prompt: async () => 'n',
    readStdin: async () => opts.stdin ?? '',
    signal: opts.signal ?? new AbortController().signal,
  };
  return io;
}

/** Fresh temp dir holding a copy of one core fixture. */
export function workDirWithFixture(name = 'a-modest-proposal.epub'): { dir: string; input: string } {
  const dir = mkdtempSync(join(tmpdir(), 'epubtrans-cli-'));
  const input = join(dir, name);
  copyFileSync(join(FIXTURE_DIR, name), input);
  return { dir, input };
}

/** First entry of a zip: its local file header must start with the stored `mimetype` file. */
export function firstZipEntryName(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error('not a zip archive');
  const nameLength = view.getUint16(26, true);
  return new TextDecoder().decode(bytes.subarray(30, 30 + nameLength));
}

export interface MockCall {
  path: string;
  authorization: string | null;
  segmentIds: string[];
}

export interface MockProvider {
  url: string;
  calls: MockCall[];
  stop(): void;
}

/**
 * Local OpenAI-compatible server: /models and /chat/completions. The "translation" prefixes every text
 * node with "[vi] " and keeps the markup. `onChat` can intercept a request (call number is 1-based).
 */
export function startMockProvider(onChat?: (call: number) => Response | undefined): MockProvider {
  const calls: MockCall[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.endsWith('/models')) return Response.json({ data: [{ id: 'mock-b' }, { id: 'mock-a' }] });
      if (!path.endsWith('/chat/completions')) return new Response('not found', { status: 404 });
      const body = (await req.json()) as { messages: { role: string; content: string }[] };
      const user = JSON.parse(body.messages.find((m) => m.role === 'user')?.content ?? '{}') as { segments: { id: string; html: string }[] };
      calls.push({ path, authorization: req.headers.get('authorization'), segmentIds: user.segments.map((s) => s.id) });
      const intercepted = onChat?.(calls.length);
      if (intercepted) return intercepted;
      const segments = user.segments.map((s) => ({
        id: s.id,
        html: s.html.replace(/>([^<]+)</g, (_, t: string) => (t.trim() ? `>[vi] ${t}<` : `>${t}<`)).replace(/^([^<]+)/, '[vi] $1'),
      }));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ segments }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, calls, stop: () => void server.stop(true) };
}
