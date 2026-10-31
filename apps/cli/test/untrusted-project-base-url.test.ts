import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { importBook } from '@epubtrans/core';
import { domEnv } from '../src/dom-env';
import { writeProjectFile } from '../src/project-store';
import { run } from '../src/run';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const SECRET = 'sk-or-SECRET123';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

/** A shared project file whose stored endpoint points at a server the attacker controls. */
async function projectPointingAt(evil: MockProvider, providerId: string) {
  const { dir, input } = workDirWithFixture();
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const project = await importBook(new Uint8Array(await Bun.file(input).arrayBuffer()), 'a-modest-proposal.epub', domEnv);
  project.settings = { ...project.settings, targetLang: 'vi', providerId, baseURL: `${evil.url}/v1`, model: 'some-model' };
  const path = `${dir}/shared.epubtrans`;
  await writeProjectFile(project, path);
  return { dir, path, out: `${dir}/out.epub` };
}

describe('a base URL stored in a project file never receives the API key', () => {
  let evil: MockProvider;
  let outgoing: string[];
  beforeEach(() => {
    evil = startMockProvider();
    cleanup.push(() => evil.stop());
    outgoing = [];
    // Local servers are reached for real; anything else (the preset endpoints) must not leave the machine:
    // record the URL and fail the request.
    const realFetch = globalThis.fetch;
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      outgoing.push(url);
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
      return new Response('{"error":{"message":"stubbed"}}', { status: 401, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    cleanup.push(() => spy.mockRestore());
  });

  /** Everything seen by the attacker's server, including the price lookup (`/models`). */
  const evilHits = () => outgoing.filter((u) => u.startsWith(evil.url)).length;

  test('declining at the prompt sends nothing to any provider endpoint', async () => {
    const t = await projectPointingAt(evil, 'openrouter');
    const io = createTestIo({ env: { OPENROUTER_API_KEY: SECRET }, interactive: true });
    expect(await run(['resume', t.path, '--out', t.out], io)).toBe(1);
    expect(io.stderr).toContain('Cancelled');
    expect(outgoing).toEqual([]);
    expect(evilHits()).toBe(0);
  });

  test('--yes goes to the preset endpoint, never to the stored one', async () => {
    const t = await projectPointingAt(evil, 'openrouter');
    const io = createTestIo({ env: { OPENROUTER_API_KEY: SECRET } });
    await run(['resume', t.path, '--yes', '--concurrency', '1', '--out', t.out], io);
    expect(outgoing.length).toBeGreaterThan(0);
    expect(outgoing.every((u) => u.startsWith('https://openrouter.ai/api/v1'))).toBe(true);
    expect(evilHits()).toBe(0);
    expect(io.stderr + io.stdout).not.toContain(SECRET);
  });

  test('translate on top of an existing project file is protected the same way', async () => {
    const t = await projectPointingAt(evil, 'openrouter');
    const io = createTestIo({ env: { OPENROUTER_API_KEY: SECRET }, interactive: true });
    const input = t.path.replace('shared.epubtrans', 'a-modest-proposal.epub');
    expect(await run(['translate', input, '--project', t.path, '--to', 'vi', '--out', t.out], io)).toBe(1);
    expect(outgoing).toEqual([]);
    expect(evilHits()).toBe(0);
  });

  test('custom provider needs --base-url on every run and fails before any key is read', async () => {
    const t = await projectPointingAt(evil, 'custom');
    const reads: string[] = [];
    const env = new Proxy({ EPUBTRANS_API_KEY: SECRET } as Record<string, string | undefined>, {
      get: (target, prop) => {
        reads.push(String(prop));
        return target[prop as string];
      },
    });
    for (const extra of [[], ['--yes']]) {
      const io = createTestIo({ env });
      expect(await run(['resume', t.path, ...extra, '--out', t.out], io)).toBe(2);
      expect(io.stderr).toContain('needs --base-url on every run');
    }
    expect(reads).toEqual([]);
    expect(outgoing).toEqual([]);
    expect(evilHits()).toBe(0);
  });

  test('an explicit --base-url on this run is honoured', async () => {
    const t = await projectPointingAt(evil, 'custom');
    const good = startMockProvider();
    cleanup.push(() => good.stop());
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: SECRET } });
    await run(['resume', t.path, '--base-url', `${good.url}/v1`, '--yes', '--out', t.out], io);
    expect(outgoing.some((u) => u.startsWith(good.url))).toBe(true);
    expect(evilHits()).toBe(0);
  });
});
