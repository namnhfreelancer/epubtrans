import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { loadProjectFile } from '@epubtrans/core';
import { run } from '../src/run';
import { formatSampleReport } from '../src/sample-report';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const SECRET = 'sk-test-gateway-secret-5e4d3c2b1a';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

const echoKey = (status: number) => (): Response =>
  new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${SECRET}. Authorization: Bearer ${SECRET}` } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function setup(status: number) {
  const server = startMockProvider(echoKey(status));
  const { dir, input } = workDirWithFixture();
  cleanup.push(
    () => server.stop(),
    () => rmSync(dir, { recursive: true, force: true }),
  );
  return { server, input, project: `${input}.epubtrans` };
}

const providerArgs = (server: MockProvider) => ['--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--concurrency', '1', '--yes'];
const env = { EPUBTRANS_API_KEY: SECRET };
const latin1 = (path: string) => new TextDecoder('latin1').decode(readFileSync(path));

describe('CLI never prints or saves a key the provider echoed', () => {
  test('a 401 with an echoing body: output and project file are clean', async () => {
    const t = setup(401);
    const io = createTestIo({ env });
    expect(await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server)], io)).toBe(1);
    expect(io.stderr).toContain('Error: HTTP 401');
    expect(io.stderr).toContain('[redacted]');
    expect(io.stderr + io.stdout).not.toContain(SECRET);
    expect(latin1(t.project)).not.toContain(SECRET);
  });

  test('a 400 with an echoing body marks segments failed with a redacted reason', async () => {
    const t = setup(400);
    const io = createTestIo({ env });
    await run(['translate', t.input, '--to', 'vi', ...providerArgs(t.server)], io);
    expect(io.stderr + io.stdout).not.toContain(SECRET);
    const project = await loadProjectFile(new Uint8Array(readFileSync(t.project)));
    const failed = project.chapters.flatMap((c) => c.segments).filter((s) => s.status === 'error');
    for (const s of failed) expect(s.error).not.toContain(SECRET);
    expect(latin1(t.project)).not.toContain(SECRET);
  });

  test('the sample report redacts an error already stored on a segment', () => {
    const project = {
      chapters: [{ href: 'c.xhtml', title: 'C', segments: [{ id: 'a', sourceHtml: '<p>Hi</p>', sourceText: 'Hi', status: 'error', error: `bad ${SECRET}` }] }],
    } as unknown as Parameters<typeof formatSampleReport>[0];
    const report = formatSampleReport(project, { seed: 1, passages: [{ chapterHref: 'c.xhtml', chapterTitle: 'C', segmentIds: ['a'] }] });
    expect(report).toContain('[redacted]');
    expect(report).not.toContain(SECRET);
  });
});
