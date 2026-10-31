import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { loadProjectFile } from '@epubtrans/core';
import { run } from '../src/run';
import { htmlToPlainText } from '../src/sample-report';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const SECRET = 'sk-test-secret-key';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function setup() {
  const server = startMockProvider();
  const { dir, input } = workDirWithFixture();
  cleanup.push(
    () => server.stop(),
    () => rmSync(dir, { recursive: true, force: true }),
  );
  return { server, dir, input, project: `${input}.epubtrans` };
}

const providerArgs = (server: MockProvider) => ['--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--concurrency', '1', '--yes'];
const env = { EPUBTRANS_API_KEY: SECRET };

async function readProject(path: string) {
  const project = await loadProjectFile(new Uint8Array(readFileSync(path)));
  const segments = project.chapters.flatMap((c) => c.segments);
  return { project, translated: segments.filter((s) => s.status === 'translated').map((s) => s.id), total: segments.length };
}

describe('epubtrans sample', () => {
  test('translates passages from a new book, prints source/translation pairs and saves the selection', async () => {
    const t = setup();
    const io = createTestIo({ env });
    const code = await run(['sample', t.input, '--to', 'vi', '--passages', '3', '--seed', '5', ...providerArgs(t.server)], io);

    expect(code).toBe(0);
    expect(io.stderr).toContain('Sample:');
    expect(io.stderr).toContain('seed 5');
    expect(io.stderr).toContain('Estimated usage');
    expect(io.stdout).toContain('=== Passage 1/3:');
    expect(io.stdout).toContain('=== Passage 3/3:');
    expect(io.stdout).toMatch(/source:\n.+\ntranslation:\n\[vi\] /);
    expect(io.stdout).not.toContain('<p>');
    expect(io.stderr + io.stdout).not.toContain(SECRET);

    const { project, translated, total } = await readProject(t.project);
    expect(project.lastSample?.seed).toBe(5);
    expect(project.lastSample?.passages).toHaveLength(3);
    const sampled = project.lastSample?.passages.flatMap((p) => p.segmentIds) ?? [];
    expect([...translated].sort()).toEqual([...sampled].sort());
    expect(translated.length).toBeLessThan(total);
    expect(t.server.calls.flatMap((c) => c.segmentIds).sort()).toEqual([...sampled].sort());
    expect(t.server.calls.every((c) => c.authorization === `Bearer ${SECRET}`)).toBe(true);
  });

  test('running it again resends the same segments, --new picks another seed, and translate then skips every sampled segment', async () => {
    const t = setup();
    const common = [...providerArgs(t.server)];
    await run(['sample', t.input, '--to', 'vi', '--passages', '3', '--seed', '5', ...common], createTestIo({ env }));
    const first = await readProject(t.project);
    const sampled = first.project.lastSample?.passages.flatMap((p) => p.segmentIds) ?? [];
    const callsAfterFirst = t.server.calls.length;

    const again = createTestIo({ env });
    expect(await run(['sample', t.input, ...common], again)).toBe(0);
    expect(again.stderr).toContain('seed 5');
    const resent = t.server.calls.slice(callsAfterFirst).flatMap((c) => c.segmentIds);
    expect(resent.sort()).toEqual([...sampled].sort());

    const callsAfterAgain = t.server.calls.length;
    expect(await run(['sample', t.project, '--new', '--passages', '3', ...common], createTestIo({ env }))).toBe(0);
    const renewed = await readProject(t.project);
    expect(renewed.project.lastSample?.seed).not.toBe(5);
    const renewedIds = renewed.project.lastSample?.passages.flatMap((p) => p.segmentIds) ?? [];
    expect(
      t.server.calls
        .slice(callsAfterAgain)
        .flatMap((c) => c.segmentIds)
        .sort(),
    ).toEqual([...renewedIds].sort());

    const callsBeforeFull = t.server.calls.length;
    expect(await run(['translate', t.input, '--to', 'vi', ...common, '--out', `${t.dir}/book.vi.epub`], createTestIo({ env }))).toBe(0);
    const skipped = new Set(renewed.translated);
    const sent = t.server.calls.slice(callsBeforeFull).flatMap((c) => c.segmentIds);
    expect(sent.some((id) => skipped.has(id))).toBe(false);
    expect(sent.length + skipped.size).toBe(renewed.total);
  });

  test('without --yes and a terminal nothing is sent; declining the prompt sends nothing either', async () => {
    const t = setup();
    const args = providerArgs(t.server).filter((a) => a !== '--yes');
    const quiet = createTestIo({ env });
    expect(await run(['sample', t.input, '--to', 'vi', ...args], quiet)).toBe(2);
    expect(quiet.stderr).toContain('--yes');
    const declined = createTestIo({ env, interactive: true });
    expect(await run(['sample', t.input, '--to', 'vi', ...args], declined)).toBe(1);
    expect(declined.stderr).toContain('Cancelled');
    expect(t.server.calls.length).toBe(0);
    expect(existsSync(t.project)).toBe(true);
  });

  test('usage errors exit with 2', async () => {
    const t = setup();
    for (const argv of [
      ['sample'],
      ['sample', t.input, '--to', 'vi', '--passages', '0', ...providerArgs(t.server)],
      ['sample', t.input, '--to', 'vi', '--seed', '-3', ...providerArgs(t.server)],
      ['sample', t.input, ...providerArgs(t.server)],
      ['sample', '/nope/missing.epubtrans', ...providerArgs(t.server)],
    ]) {
      const io = createTestIo({ env });
      expect(await run(argv, io)).toBe(2);
    }
    expect(t.server.calls.length).toBe(0);
    const help = createTestIo();
    expect(await run(['sample', '--help'], help)).toBe(0);
    expect(help.stdout).toContain('--passages');
  });
});

describe('htmlToPlainText', () => {
  test('drops tags and decodes entities', () => {
    expect(htmlToPlainText('A <b>bold</b>&nbsp;move &amp; <i>more</i>&#8212;done&#x21;<br/>next &unknown;')).toBe('A bold move & more—done! next &unknown;');
  });
});
