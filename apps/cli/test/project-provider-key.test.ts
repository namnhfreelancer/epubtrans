import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { importBook, loadProjectFile } from '@epubtrans/core';
import { domEnv } from '../src/dom-env';
import { writeProjectFile } from '../src/project-store';
import { run } from '../src/run';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const GENERIC = 'sk-generic-OPENAI-key';
const OWN = 'sk-deepseek-own-key';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

/** A shared project file whose provider is deepseek. */
async function deepseekProject() {
  const { dir, input } = workDirWithFixture();
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const project = await importBook(new Uint8Array(await Bun.file(input).arrayBuffer()), 'a-modest-proposal.epub', domEnv);
  project.settings = { ...project.settings, targetLang: 'vi', providerId: 'deepseek', model: 'some-model' };
  const path = `${dir}/shared.epubtrans`;
  await writeProjectFile(project, path);
  return { dir, input, path, out: `${dir}/out.epub` };
}

describe('the generic EPUBTRANS_API_KEY is not given to a provider chosen by a project file', () => {
  let mock: MockProvider;
  let outgoing: string[];
  beforeEach(() => {
    mock = startMockProvider();
    cleanup.push(() => mock.stop());
    outgoing = [];
    // Requests to the real DeepSeek endpoint are recorded and served by the local mock instead.
    const realFetch = globalThis.fetch;
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      outgoing.push(url);
      const rewritten = url.replace('https://api.deepseek.com', `${mock.url}`);
      return realFetch(rewritten, init);
    }) as unknown as typeof fetch);
    cleanup.push(() => spy.mockRestore());
  });

  test('resume with only EPUBTRANS_API_KEY fails with guidance and sends nothing', async () => {
    const t = await deepseekProject();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(['resume', t.path, '--yes', '--out', t.out], io)).toBe(2);
    expect(io.stderr).toContain('comes from the project file');
    expect(io.stderr).toContain('DEEPSEEK_API_KEY');
    expect(io.stderr).toContain('--provider deepseek');
    expect(io.stderr).toContain('--api-key-file');
    expect(io.stderr).not.toContain('Using API key');
    expect(io.stderr + io.stdout).not.toContain(GENERIC);
    expect(outgoing).toEqual([]);
    expect(mock.calls).toEqual([]);
  });

  test('translate on top of an existing project file is protected the same way', async () => {
    const t = await deepseekProject();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(['translate', t.input, '--project', t.path, '--to', 'vi', '--yes', '--out', t.out], io)).toBe(2);
    expect(io.stderr).toContain('comes from the project file');
    expect(outgoing).toEqual([]);
  });

  test('--provider deepseek on this run allows EPUBTRANS_API_KEY', async () => {
    const t = await deepseekProject();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(['resume', t.path, '--provider', 'deepseek', '--yes', '--concurrency', '1', '--out', t.out], io)).toBe(0);
    expect(io.stderr).toContain('Using API key from env EPUBTRANS_API_KEY');
    expect(mock.calls.length).toBeGreaterThan(0);
    expect(mock.calls.every((c) => c.authorization === `Bearer ${GENERIC}`)).toBe(true);
    expect(outgoing.every((u) => u.startsWith('https://api.deepseek.com'))).toBe(true);
  });

  test("the provider's own variable works without --provider, and wins over the generic key", async () => {
    const t = await deepseekProject();
    const io = createTestIo({ env: { DEEPSEEK_API_KEY: OWN, EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(['resume', t.path, '--yes', '--concurrency', '1', '--out', t.out], io)).toBe(0);
    expect(io.stderr).toContain('Using API key from env DEEPSEEK_API_KEY');
    expect(mock.calls.length).toBeGreaterThan(0);
    expect(mock.calls.every((c) => c.authorization === `Bearer ${OWN}`)).toBe(true);
  });

  test('--api-key-file works without --provider', async () => {
    const t = await deepseekProject();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC }, stdin: `${OWN}\n` });
    expect(await run(['resume', t.path, '--api-key-file', '-', '--yes', '--concurrency', '1', '--out', t.out], io)).toBe(0);
    expect(mock.calls.every((c) => c.authorization === `Bearer ${OWN}`)).toBe(true);
  });

  test('a fresh translate without a project file keeps using EPUBTRANS_API_KEY', async () => {
    const { dir, input } = workDirWithFixture();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    const code = await run(
      [
        'translate',
        input,
        '--to',
        'vi',
        '--provider',
        'custom',
        '--base-url',
        mock.url,
        '--model',
        'm',
        '--yes',
        '--concurrency',
        '1',
        '--out',
        `${dir}/o.epub`,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(mock.calls.every((c) => c.authorization === `Bearer ${GENERIC}`)).toBe(true);
  });
});

describe('the default provider keeps working with EPUBTRANS_API_KEY after a project file exists', () => {
  let mock: MockProvider;
  let outgoing: string[];
  let interrupt: AbortController;
  beforeEach(() => {
    interrupt = new AbortController();
    // Interrupt during the third request so the project file is left partly translated.
    mock = startMockProvider((call) => {
      if (call === 3) interrupt.abort();
      return undefined;
    });
    cleanup.push(() => mock.stop());
    outgoing = [];
    // Requests to the real OpenAI endpoint are recorded and served by the local mock instead.
    const realFetch = globalThis.fetch;
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      outgoing.push(url);
      return realFetch(url.replace('https://api.openai.com', mock.url), init);
    }) as unknown as typeof fetch);
    cleanup.push(() => spy.mockRestore());
  });

  async function remainingIds(path: string): Promise<string[]> {
    const project = await loadProjectFile(new Uint8Array(readFileSync(path)));
    return project.chapters.flatMap((c) => c.segments.filter((s) => s.status !== 'translated').map((s) => s.id));
  }

  test('re-running the identical translate command (no --provider) resumes with only the remaining segments', async () => {
    const { dir, input } = workDirWithFixture();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const args = ['translate', input, '--to', 'vi', '--model', 'gpt-x', '--yes', '--concurrency', '1', '--out', `${dir}/o.epub`];

    const first = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC }, signal: interrupt.signal });
    expect(await run(args, first)).toBe(130);
    const remaining = await remainingIds(`${input}.epubtrans`);
    expect(remaining.length).toBeGreaterThan(0);
    const callsInFirstRun = mock.calls.length;

    const second = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(args, second)).toBe(0);
    expect(second.stderr).toContain('Using API key from env EPUBTRANS_API_KEY');
    const resent = mock.calls.slice(callsInFirstRun);
    expect(resent.flatMap((c) => c.segmentIds).sort()).toEqual([...remaining].sort());
    expect(resent.every((c) => c.authorization === `Bearer ${GENERIC}`)).toBe(true);
    expect(outgoing.every((u) => u.startsWith('https://api.openai.com'))).toBe(true);
    expect(await remainingIds(`${input}.epubtrans`)).toEqual([]);
  });

  test('resume <project> for a default-provider project works with only EPUBTRANS_API_KEY', async () => {
    const { dir, input } = workDirWithFixture();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const first = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC }, signal: interrupt.signal });
    expect(await run(['translate', input, '--to', 'vi', '--model', 'gpt-x', '--yes', '--concurrency', '1', '--out', `${dir}/o.epub`], first)).toBe(130);
    const remaining = await remainingIds(`${input}.epubtrans`);
    const callsInFirstRun = mock.calls.length;

    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(['resume', `${input}.epubtrans`, '--yes', '--concurrency', '1', '--out', `${dir}/r.epub`], io)).toBe(0);
    expect(io.stderr).toContain('Using API key from env EPUBTRANS_API_KEY');
    expect(
      mock.calls
        .slice(callsInFirstRun)
        .flatMap((c) => c.segmentIds)
        .sort(),
    ).toEqual([...remaining].sort());
    expect(outgoing.every((u) => u.startsWith('https://api.openai.com'))).toBe(true);
  });

  test('a deepseek project with only EPUBTRANS_API_KEY still exits 2 and sends nothing', async () => {
    const t = await deepseekProject();
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: GENERIC } });
    expect(await run(['resume', t.path, '--yes', '--out', t.out], io)).toBe(2);
    expect(outgoing).toEqual([]);
    expect(mock.calls).toEqual([]);
  });
});
