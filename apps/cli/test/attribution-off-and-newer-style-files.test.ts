import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { importBook, loadProjectFile, type Project, saveProjectFile } from '@epubtrans/core';
import { readZip } from '../../../packages/core/src/util/zip-archive';
import { domEnv } from '../src/dom-env';
import { run } from '../src/run';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

const ATTRIBUTION_PAGE = 'OEBPS/epubtrans-attribution.xhtml';

/** A fully translated project file (attribution on, unless `settings` says otherwise) next to a copy of the fixture. */
async function projectFile(settings: Partial<Project['settings']> = { attribution: true }) {
  const { dir, input } = workDirWithFixture();
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const project = await importBook(new Uint8Array(readFileSync(input)), 'a.epub', domEnv);
  project.settings = { ...project.settings, model: 'mock-model', ...settings };
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = `[vi] ${s.sourceHtml}`;
    s.status = 'translated';
  }
  const path = `${dir}/book.epubtrans`;
  writeFileSync(path, await saveProjectFile(project));
  return { dir, path };
}

const exported = (path: string) => readZip(new Uint8Array(readFileSync(path)));
const load = async (path: string) => loadProjectFile(new Uint8Array(readFileSync(path)));

describe('--no-attribution', () => {
  test('export leaves the page out of this export only', async () => {
    const t = await projectFile();
    const out = `${t.dir}/plain.epub`;
    expect(await run(['export', t.path, '--no-attribution', '--out', out], createTestIo())).toBe(0);
    expect(exported(out).has(ATTRIBUTION_PAGE)).toBe(false);
    expect((await load(t.path)).settings.attribution).toBe(true);
    const again = `${t.dir}/again.epub`;
    expect(await run(['export', t.path, '--out', again], createTestIo())).toBe(0);
    expect(exported(again).has(ATTRIBUTION_PAGE)).toBe(true);
  });

  test('cannot be combined with --attribution', async () => {
    const t = await projectFile();
    const io = createTestIo();
    expect(await run(['export', t.path, '--attribution', '--no-attribution'], io)).toBe(2);
    expect(io.stderr).toContain('cannot be used together');
  });

  describe('resume', () => {
    let server: MockProvider | undefined;
    afterEach(() => server?.stop());
    const resume = (path: string, extra: string[], out: string) => {
      server = server ?? startMockProvider();
      const args = ['resume', path, '--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--yes', ...extra, '--out', out];
      return run(args, createTestIo({ env: { EPUBTRANS_API_KEY: 'sk-test' } }));
    };

    test('turns a saved attribution off and saves that; without a flag the saved choice stays', async () => {
      const t = await projectFile();
      expect(await resume(t.path, [], `${t.dir}/a.epub`)).toBe(0);
      expect((await load(t.path)).settings.attribution).toBe(true);
      expect(exported(`${t.dir}/a.epub`).has(ATTRIBUTION_PAGE)).toBe(true);

      expect(await resume(t.path, ['--no-attribution'], `${t.dir}/b.epub`)).toBe(0);
      expect('attribution' in (await load(t.path)).settings).toBe(false);
      expect(exported(`${t.dir}/b.epub`).has(ATTRIBUTION_PAGE)).toBe(false);

      expect(await resume(t.path, [], `${t.dir}/c.epub`)).toBe(0);
      expect(exported(`${t.dir}/c.epub`).has(ATTRIBUTION_PAGE)).toBe(false);
    });
  });
});

describe('files written by a newer version', () => {
  test('a --style-file with a byte order mark and unknown keys is used, naming the skipped keys', async () => {
    const t = await projectFile({});
    const style = `${t.dir}/style.json`;
    writeFileSync(style, `﻿${JSON.stringify({ source: { color: '#123456', shadow: '1px' }, pageMargins: 2 })}`);
    const out = `${t.dir}/styled.epub`;
    const io = createTestIo();
    expect(await run(['export', t.path, '--style-file', style, '--out', out], io)).toBe(0);
    expect(new TextDecoder().decode(exported(out).get('OEBPS/epubtrans.css'))).toContain('color: #123456');
    expect(io.stderr).toContain('ignored settings this version of epubtrans does not know');
    expect(io.stderr).toContain('"style.pageMargins", "style.source.shadow"');
  });

  test('a project whose export style has unknown keys still opens, with a warning', async () => {
    const t = await projectFile({ exportStyle: { source: { color: '#1f7a8c' }, futureKey: true } as unknown as Project['settings']['exportStyle'] });
    const out = `${t.dir}/out.epub`;
    const io = createTestIo();
    expect(await run(['export', t.path, '--out', out], io)).toBe(0);
    expect(io.stderr).toContain('"settings.exportStyle.futureKey"');
    expect(new TextDecoder().decode(exported(out).get('OEBPS/epubtrans.css'))).toContain('#1f7a8c');
  });
});
