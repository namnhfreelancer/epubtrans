import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { importBook } from '@epubtrans/core';
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
