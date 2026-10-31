import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadProjectFile } from '@epubtrans/core';
import { run } from '../src/run';
import { applyRunFlags, selectProvider } from '../src/settings';
import { createTestIo, firstZipEntryName, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function setup(fixture?: string, onChat?: Parameters<typeof startMockProvider>[0]) {
  const server = startMockProvider(onChat);
  const { dir, input } = workDirWithFixture(fixture);
  cleanup.push(
    () => server.stop(),
    () => rmSync(dir, { recursive: true, force: true }),
  );
  return { server, dir, input, project: `${input}.epubtrans` };
}

const providerArgs = (server: MockProvider) => ['--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--concurrency', '1', '--yes'];
const env = { EPUBTRANS_API_KEY: 'sk-test' };
const loadProject = async (path: string) => loadProjectFile(new Uint8Array(readFileSync(path)));

describe('run tuning flags', () => {
  const selection = selectProvider({ provider: 'openai' });
  const base = {
    sourceLang: 'en',
    targetLang: 'vi',
    providerId: 'openai',
    baseURL: '',
    model: 'm',
    concurrency: 1,
    twoPass: false,
    guideline: '',
    glossary: [],
  };

  test('apply --max-segments, --reasoning, --cached-ratio and --identical-min-letters to the settings', () => {
    const settings = applyRunFlags(base, { 'max-segments': 8, reasoning: 'OFF', 'cached-ratio': 0.25, 'identical-min-letters': 0 }, selection);
    expect(settings).toMatchObject({ maxSegmentsPerBatch: 8, reasoning: 'off', cachedInputRatio: 0.25, identicalMinLetters: 0 });
  });

  test('reject invalid values', () => {
    expect(() => applyRunFlags(base, { 'max-segments': 0 }, selection)).toThrow('--max-segments must be an integer between 1 and 200');
    expect(() => applyRunFlags(base, { reasoning: 'max' }, selection)).toThrow('Unknown --reasoning "max". Use one of: default, low, off');
    expect(() => applyRunFlags(base, { 'cached-ratio': -1 }, selection)).toThrow(/--cached-ratio must be between 0 and 2/);
    expect(() => applyRunFlags(base, { 'identical-min-letters': 1.5 }, selection)).toThrow(/--identical-min-letters/);
  });
});

describe('TXT and Markdown input, segment cap and glossary files', () => {
  test('translates a TXT book with --max-segments and writes a valid EPUB next to it', async () => {
    const t = setup('aesop-fables.txt');
    const io = createTestIo({ env });
    const out = `${t.dir}/aesop.vi.epub`;
    const code = await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--max-segments', '2', '--out', out], io);
    expect(code).toBe(0);
    expect(io.stderr).toContain('Imported "Three Fables of Aesop"');
    expect(t.server.calls.every((c) => c.segmentIds.length <= 2)).toBe(true);
    expect(firstZipEntryName(new Uint8Array(readFileSync(out)))).toBe('mimetype');
    expect((await loadProject(t.project)).settings.maxSegmentsPerBatch).toBe(2);
  });

  test('sample on a Markdown book merges a glossary file, keeping entries already in the project', async () => {
    const t = setup('aesop-fables.md');
    const glossary = `${t.dir}/names.csv`;
    writeFileSync(glossary, 'term,translation,type,note\nFox,Cáo,other,animal\nfox,Con cáo\nWolf,Sói,,\n');
    const io = createTestIo({ env });
    const code = await run(['sample', t.input, '--to', 'vi', ...providerArgs(t.server), '--glossary-file', glossary, '--passages', '1'], io);
    expect(code).toBe(0);
    expect(io.stderr).toContain(`Glossary: 2 entries added from ${glossary}; 1 duplicates in the file ignored`);
    expect((await loadProject(t.project)).settings.glossary).toEqual([
      { term: 'Fox', translation: 'Cáo', type: 'other', note: 'animal' },
      { term: 'Wolf', translation: 'Sói' },
    ]);

    // Running again adds nothing: the project's entries win.
    const again = createTestIo({ env });
    await run(['sample', t.project, ...providerArgs(t.server), '--glossary-file', glossary], again);
    expect(again.stderr).toContain('Glossary: 0 entries added');
    expect(again.stderr).toContain('2 already in the project (kept as they are)');
  });

  test('refuses an invalid glossary file before any request', async () => {
    const t = setup('aesop-fables.txt');
    const bad = `${t.dir}/bad.tsv`;
    writeFileSync(bad, 'Fox\tCáo\nWolf\t\n');
    const io = createTestIo({ env });
    const code = await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--glossary-file', bad], io);
    expect(code).toBe(2);
    expect(io.stderr).toContain('line 2: the translation of "Wolf" is empty');
    expect(t.server.calls).toHaveLength(0);
    const unknown = createTestIo({ env });
    expect(await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server), '--glossary-file', `${t.dir}/x.xlsx`], unknown)).toBe(2);
  });

  test('glossary export writes CSV, TSV or JSON from a project file', async () => {
    const t = setup('aesop-fables.txt');
    const glossary = `${t.dir}/in.json`;
    writeFileSync(glossary, JSON.stringify([{ term: '=Fox', translation: 'Cáo', type: 'other' }]));
    await run(['sample', t.input, '--to', 'vi', ...providerArgs(t.server), '--glossary-file', glossary, '--passages', '1'], createTestIo({ env }));
    const io = createTestIo();
    expect(await run(['glossary', 'export', t.project, '--out', `${t.dir}/out.csv`], io)).toBe(0);
    expect(io.stderr).toContain('Wrote 1 glossary entries');
    expect(readFileSync(`${t.dir}/out.csv`, 'utf8')).toBe("term,translation,type,note\r\n'=Fox,Cáo,other,\r\n");
    expect(await run(['glossary', 'export', t.project, '--out', `${t.dir}/out.dat`, '--format', 'json'], createTestIo())).toBe(0);
    expect(JSON.parse(readFileSync(`${t.dir}/out.dat`, 'utf8'))).toEqual([{ term: '=Fox', translation: 'Cáo', type: 'other' }]);
    expect(await run(['glossary', 'export', t.project], createTestIo())).toBe(2);
    expect(await run(['glossary', 'import', t.project], createTestIo())).toBe(2);
  });
});

describe('identical translations and cached tokens', () => {
  test('warns about translations identical to the source and shows cached tokens and their cost', async () => {
    const t = setup('aesop-fables.txt', () => undefined);
    // Echo every segment unchanged and report cached prompt tokens.
    t.server.stop();
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { messages: { role: string; content: string }[] };
        const user = JSON.parse(body.messages.find((m) => m.role === 'user')?.content ?? '{}') as { segments: { id: string; html: string }[] };
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ segments: user.segments }) } }],
          usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 600 } },
        });
      },
    });
    cleanup.push(() => void server.stop(true));
    const io = createTestIo({ env });
    const args = ['--provider', 'custom', '--base-url', `http://127.0.0.1:${server.port}`, '--model', 'm', '--yes', '--price-in', '1', '--price-out', '2'];
    const code = await run(['translate', t.input, '--to', 'vi', ...args, '--cached-ratio', '0.1', '--out', `${t.dir}/o.epub`], io);
    expect(code).toBe(0);
    expect(io.stderr).toMatch(/Warning: 18 translations are identical to the source \(c0-1, .*, \.\.\.\); they are exported as they are/);
    expect(io.stderr).toMatch(/Tokens used: [\d.]+k in \([\d.]+k cached\) \/ \d+ out \(\$/);
  });
});
