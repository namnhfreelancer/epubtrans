import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { loadProjectFile } from '@epubtrans/core';
import { run } from '../src/run';
import { createTestIo, firstZipEntryName, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const SECRET = 'sk-test-secret-key';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function setup(onChat?: Parameters<typeof startMockProvider>[0], fixture?: string) {
  const server = startMockProvider(onChat);
  const { dir, input } = workDirWithFixture(fixture);
  cleanup.push(
    () => server.stop(),
    () => rmSync(dir, { recursive: true, force: true }),
  );
  return { server, dir, input, project: `${input}.epubtrans`, out: `${dir}/book.vi.epub` };
}

const providerArgs = (server: MockProvider) => ['--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--concurrency', '1', '--yes'];
const env = { EPUBTRANS_API_KEY: SECRET };

async function projectCounts(path: string) {
  const project = await loadProjectFile(new Uint8Array(readFileSync(path)));
  const segments = project.chapters.flatMap((c) => c.segments);
  return {
    project,
    total: segments.length,
    translated: segments.filter((s) => s.status === 'translated').map((s) => s.id),
    other: segments.filter((s) => s.status !== 'translated').map((s) => s.id),
  };
}

describe('translate and resume against a mock OpenAI-compatible server', () => {
  test('translate writes the project and an EPUB whose first entry is mimetype; the key only reaches the provider', async () => {
    const t = setup();
    const io = createTestIo({ env });
    const code = await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--out', t.out], io);

    expect(code).toBe(0);
    expect(io.stderr).toContain('Estimated usage');
    expect(io.stderr).toContain('Source language: en (auto-detected)');
    expect(existsSync(t.project)).toBe(true);
    expect(firstZipEntryName(new Uint8Array(readFileSync(t.out)))).toBe('mimetype');
    expect(t.server.calls.length).toBeGreaterThan(3);
    expect(t.server.calls.every((c) => c.authorization === `Bearer ${SECRET}`)).toBe(true);
    expect(io.stderr + io.stdout).not.toContain(SECRET);
    const counts = await projectCounts(t.project);
    expect(counts.other).toEqual([]);
    expect(counts.project.settings).toMatchObject({ targetLang: 'vi', sourceLang: 'en', providerId: 'custom', model: 'mock-model' });
  });

  for (const fixture of ['a-modest-proposal.mobi', 'a-modest-proposal.azw3', 'aesop-fables.fb2']) {
    test(`translates ${fixture} into a valid EPUB through the CLI`, async () => {
      const t = setup(undefined, fixture);
      const io = createTestIo({ env });
      expect(await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--concurrency', '4', '--out', t.out], io)).toBe(0);
      expect(firstZipEntryName(new Uint8Array(readFileSync(t.out)))).toBe('mimetype');
      expect((await projectCounts(t.project)).other).toEqual([]);
    });
  }

  test('Ctrl-C keeps progress; re-running translate and resume only send the remaining segments', async () => {
    const interrupt = new AbortController();
    const t = setup((call) => {
      if (call === 3) interrupt.abort();
      return undefined;
    });

    const first = createTestIo({ env, signal: interrupt.signal });
    expect(await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--out', t.out], first)).toBe(130);
    expect(first.stderr).toContain('re-run the same command to resume');
    expect(existsSync(t.out)).toBe(false);

    const afterFirst = await projectCounts(t.project);
    expect(afterFirst.translated.length).toBeGreaterThan(0);
    expect(afterFirst.other.length).toBeGreaterThan(0);
    const callsInFirstRun = t.server.calls.length;

    // Same command again: picks up <input>.epubtrans and only asks for what is missing.
    const second = createTestIo({ env });
    expect(await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--out', t.out], second)).toBe(0);
    expect(second.stderr).toContain(`Resuming ${t.project}`);
    const resentIds = t.server.calls.slice(callsInFirstRun).flatMap((c) => c.segmentIds);
    expect(resentIds.sort()).toEqual([...afterFirst.other].sort());
    expect(resentIds.some((id) => afterFirst.translated.includes(id))).toBe(false);
    expect((await projectCounts(t.project)).other).toEqual([]);
    expect(firstZipEntryName(new Uint8Array(readFileSync(t.out)))).toBe('mimetype');

    // Everything is done now: resume must not call the provider at all.
    const callsBefore = t.server.calls.length;
    const third = createTestIo({ env });
    expect(await run(['resume', t.project, ...providerArgs(t.server), '--out', `${t.dir}/again.epub`], third)).toBe(0);
    expect(t.server.calls.length).toBe(callsBefore);
    expect(third.stderr).toContain('already translated');
  });

  test('resume continues a partial project file and export writes all three modes', async () => {
    const interrupt = new AbortController();
    const t = setup((call) => {
      if (call === 2) interrupt.abort();
      return undefined;
    });
    await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server)], createTestIo({ env, signal: interrupt.signal }));
    const partial = await projectCounts(t.project);
    const callsInFirstRun = t.server.calls.length;

    const io = createTestIo({ env });
    expect(await run(['resume', t.project, ...providerArgs(t.server), '--out', t.out, '--mode', 'bilingual-translation-first'], io)).toBe(0);
    expect(
      t.server.calls
        .slice(callsInFirstRun)
        .flatMap((c) => c.segmentIds)
        .sort(),
    ).toEqual([...partial.other].sort());

    for (const mode of ['bilingual', 'bilingual-translation-first', 'translation-only']) {
      const out = `${t.dir}/${mode}.epub`;
      const exportIo = createTestIo();
      expect(await run(['export', t.project, '--mode', mode, '--out', out], exportIo)).toBe(0);
      expect(firstZipEntryName(new Uint8Array(readFileSync(out)))).toBe('mimetype');
    }
  });

  test('a rejected key stops the run, keeps the project file and never prints the key', async () => {
    const t = setup(
      () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    const io = createTestIo({ env });
    const code = await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server)], io);
    expect(code).toBe(1);
    expect(io.stderr).toContain('Error:');
    expect(io.stderr + io.stdout).not.toContain(SECRET);
    expect(existsSync(t.project)).toBe(true);
    expect(existsSync(t.out)).toBe(false);
  });

  test('without --yes and without a terminal nothing is sent to the provider', async () => {
    const t = setup();
    const io = createTestIo({ env });
    const args = providerArgs(t.server).filter((a) => a !== '--yes');
    expect(await run(['translate', t.input, '--to', 'vi', ...args], io)).toBe(2);
    expect(io.stderr).toContain('--yes');
    expect(t.server.calls.length).toBe(0);
  });

  test('declining the confirmation prompt sends nothing', async () => {
    const t = setup();
    const io = createTestIo({ env, interactive: true });
    const args = providerArgs(t.server).filter((a) => a !== '--yes');
    expect(await run(['translate', t.input, '--to', 'vi', ...args], io)).toBe(1);
    expect(io.stderr).toContain('Cancelled');
    expect(t.server.calls.length).toBe(0);
  });

  test('--out may not overwrite the input book or the project file', async () => {
    const t = setup();
    for (const out of [t.input, t.project]) {
      const io = createTestIo({ env });
      expect(await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--out', out], io)).toBe(2);
      expect(io.stderr).toContain('would overwrite');
    }
    expect(t.server.calls.length).toBe(0);
  });

  test('changing --to on an existing project is refused', async () => {
    const t = setup();
    await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--out', t.out], createTestIo({ env }));
    const io = createTestIo({ env });
    expect(await run(['translate', t.input, '--to', 'fr', ...providerArgs(t.server)], io)).toBe(2);
    expect(io.stderr).toContain('translates to "vi"');
  });
});

describe('models, presets and errors', () => {
  test('models prints the ids from /models', async () => {
    const server = startMockProvider();
    cleanup.push(() => server.stop());
    const io = createTestIo({ env });
    expect(await run(['models', '--provider', 'custom', '--base-url', server.url], io)).toBe(0);
    expect(io.stdout).toBe('mock-a\nmock-b\n');
  });

  test('presets, version and help work without any key', async () => {
    const presets = createTestIo();
    expect(await run(['presets'], presets)).toBe(0);
    for (const id of ['anthropic', 'openai', 'gemini', 'openrouter', 'deepseek', 'custom', 'psychology', 'translation-only'])
      expect(presets.stdout).toContain(id);
    const version = createTestIo();
    expect(await run(['--version'], version)).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const help = createTestIo();
    expect(await run(['translate', '--help'], help)).toBe(0);
    expect(help.stdout).toContain('--polish, --two-pass');
    expect(help.stdout).toContain('polishes every translation for natural style');
  });

  test('usage errors exit with 2 and a hint', async () => {
    const t = setup();
    for (const argv of [
      ['bogus'],
      ['translate'],
      ['translate', t.input],
      ['translate', '/nope/missing.epub', '--to', 'vi', '--yes'],
      ['resume', '/nope/x.epubtrans'],
    ]) {
      const io = createTestIo({ env });
      expect(await run(argv, io)).toBe(2);
      expect(io.stderr.length).toBeGreaterThan(0);
    }
  });
});
