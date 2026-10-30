import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { loadProjectFile } from '@epubtrans/core';
import { promptLine } from '../src/prompt';
import { run } from '../src/run';
import { createTestIo, startMockProvider, workDirWithFixture } from './test-helpers';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

describe('promptLine', () => {
  function terminalStreams() {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    return { input, output };
  }

  test('returns the typed line', async () => {
    const { input, output } = terminalStreams();
    const answer = promptLine('Proceed? ', { input, output, signal: new AbortController().signal, onInterrupt: () => {}, terminal: true });
    input.write('y\n');
    expect(await answer).toBe('y');
  });

  test('Ctrl-C at the prompt rejects promptly and notifies the caller', async () => {
    const { input, output } = terminalStreams();
    const interrupt = new AbortController();
    const answer = promptLine('Proceed? ', { input, output, signal: interrupt.signal, onInterrupt: () => interrupt.abort(), terminal: true });
    input.write('\x03');
    await expect(answer).rejects.toThrow();
    expect(interrupt.signal.aborted).toBe(true);
  });

  test('an external abort rejects the pending question', async () => {
    const { input, output } = terminalStreams();
    const interrupt = new AbortController();
    const answer = promptLine('Proceed? ', { input, output, signal: interrupt.signal, onInterrupt: () => {}, terminal: true });
    interrupt.abort();
    await expect(answer).rejects.toThrow();
  });

  test('a command interrupted at the prompt exits with 130 without contacting the provider', async () => {
    const t = workDirWithFixture();
    const server = startMockProvider();
    const interrupt = new AbortController();
    cleanup.push(
      () => server.stop(),
      () => rmSync(t.dir, { recursive: true, force: true }),
    );
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: 'k' }, interactive: true, signal: interrupt.signal });
    io.prompt = async () => {
      interrupt.abort();
      throw new DOMException('Prompt interrupted', 'AbortError');
    };
    const code = await run(['translate', t.input, '--to', 'vi', '--provider', 'custom', '--base-url', server.url, '--model', 'm'], io);
    expect(code).toBe(130);
    expect(server.calls.length).toBe(0);
  });
});

describe('--generate-guide', () => {
  function setup() {
    const server = startMockProvider();
    const t = workDirWithFixture();
    cleanup.push(
      () => server.stop(),
      () => rmSync(t.dir, { recursive: true, force: true }),
    );
    const args = [
      'translate',
      t.input,
      '--to',
      'vi',
      '--provider',
      'custom',
      '--base-url',
      server.url,
      '--model',
      'm',
      '--concurrency',
      '1',
      '--generate-guide',
    ];
    return { server, t, args, env: { EPUBTRANS_API_KEY: 'k' } };
  }

  test('without a terminal and without --yes nothing is sent, not even the guide request', async () => {
    const { server, args, env } = setup();
    const io = createTestIo({ env });
    expect(await run(args, io)).toBe(2);
    expect(io.stderr).toContain('--yes');
    expect(io.stderr).toContain('extra request to generate the style guideline');
    expect(server.calls.length).toBe(0);
  });

  test('declining at the prompt sends nothing', async () => {
    const { server, args, env } = setup();
    const io = createTestIo({ env, interactive: true });
    expect(await run(args, io)).toBe(1);
    expect(server.calls.length).toBe(0);
  });

  test('after confirmation the guide is generated first, then used for the translation', async () => {
    const { server, t, args, env } = setup();
    const io = createTestIo({ env });
    expect(await run([...args, '--yes', '--out', `${t.dir}/book.vi.epub`], io)).toBe(0);
    expect(server.calls[0]?.segmentIds).toEqual([]);
    expect(server.calls.slice(1).every((c) => c.segmentIds.length > 0)).toBe(true);
    const project = await loadProjectFile(new Uint8Array(readFileSync(`${t.input}.epubtrans`)));
    expect(project.settings.guideline).toBe('- keep it plain');
    expect(project.settings.glossary).toEqual([{ term: 'Ireland', translation: 'Ai-len' }]);
  });
});
