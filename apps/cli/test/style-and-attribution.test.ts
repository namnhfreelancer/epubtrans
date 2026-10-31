import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { importBook, loadProjectFile, saveProjectFile, serializeStyleTemplates } from '@epubtrans/core';
import { readZip } from '../../../packages/core/src/util/zip-archive';
import { domEnv } from '../src/dom-env';
import { loadFontFile } from '../src/embedded-font-files';
import { run } from '../src/run';
import { createTestIo, type MockProvider, startMockProvider, workDirWithFixture } from './test-helpers';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

/** A translated project file next to a copy of the fixture book. */
async function projectFile() {
  const { dir, input } = workDirWithFixture();
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const project = await importBook(new Uint8Array(readFileSync(input)), 'a.epub', domEnv);
  project.settings.model = 'mock-model';
  for (const s of project.chapters.flatMap((c) => c.segments)) {
    s.translationHtml = `[vi] ${s.sourceHtml}`;
    s.status = 'translated';
  }
  const path = `${dir}/book.epubtrans`;
  writeFileSync(path, await saveProjectFile(project));
  return { dir, path, bytes: readFileSync(path) };
}

const text = (files: Map<string, Uint8Array>, path: string) => new TextDecoder().decode(files.get(path));

describe('export --style-file and --attribution', () => {
  test('a style file is validated, emitted into epubtrans.css with its fonts, and the project file stays unchanged', async () => {
    const t = await projectFile();
    const style = `${t.dir}/style.json`;
    writeFileSync(style, JSON.stringify({ source: { color: '#ABC', italic: true }, translation: { font: 'noto-serif', fontWeight: 'bold' } }));
    const out = `${t.dir}/styled.epub`;
    const io = createTestIo();
    expect(await run(['export', t.path, '--style-file', style, '--attribution', '--out', out], io)).toBe(0);
    const files = readZip(new Uint8Array(readFileSync(out)));
    const css = text(files, 'OEBPS/epubtrans.css');
    expect(css).toContain('color: #aabbcc');
    expect(css).toContain('font-family: "Noto Serif", serif');
    expect(files.get('OEBPS/epubtrans-fonts/noto-serif-regular.ttf')?.byteLength).toBe(155_240);
    expect(files.has('OEBPS/epubtrans-fonts/noto-serif-OFL.txt')).toBe(true);
    expect(text(files, 'OEBPS/epubtrans-attribution.xhtml')).toContain('Dịch bằng mock-model với epubtrans');
    expect(readFileSync(t.path).equals(t.bytes)).toBe(true);

    // Without the flags: the default look, no fonts, no attribution page.
    const plain = `${t.dir}/plain.epub`;
    expect(await run(['export', t.path, '--out', plain], createTestIo())).toBe(0);
    const plainFiles = readZip(new Uint8Array(readFileSync(plain)));
    expect(text(plainFiles, 'OEBPS/epubtrans.css')).toContain('.et-src { opacity: 0.55; }');
    expect([...plainFiles.keys()].some((k) => k.includes('epubtrans-fonts') || k.includes('attribution'))).toBe(false);
  });

  test('accepts a web template file holding one template', async () => {
    const t = await projectFile();
    const style = `${t.dir}/template.json`;
    writeFileSync(style, serializeStyleTemplates([{ name: 'Mine', style: { blockSpacingEm: 1.5 } }]));
    const out = `${t.dir}/t.epub`;
    expect(await run(['export', t.path, '--style-file', style, '--out', out], createTestIo())).toBe(0);
    expect(text(readZip(new Uint8Array(readFileSync(out))), 'OEBPS/epubtrans.css')).toContain('margin-top: 1.5em');
  });

  test.each([
    ['CSS injection in a color', JSON.stringify({ source: { color: 'red; } body { background: url(x)' } }), /source\.color/],
    ['a font outside the allowlist', JSON.stringify({ translation: { font: 'url(evil.ttf)' } }), /translation\.font/],
    ['not JSON', '{', /not valid JSON/],
    [
      'two templates',
      serializeStyleTemplates([
        { name: 'a', style: {} },
        { name: 'b', style: {} },
      ]),
      /exactly one/,
    ],
  ])('rejects %s with a usage error', async (_, content, message) => {
    const t = await projectFile();
    const style = `${t.dir}/bad.json`;
    writeFileSync(style, content);
    const io = createTestIo();
    expect(await run(['export', t.path, '--style-file', style, '--out', `${t.dir}/x.epub`], io)).toBe(2);
    expect(io.stderr).toMatch(message);
  });

  test('rejects a missing or oversized style file', async () => {
    const t = await projectFile();
    const missing = createTestIo();
    expect(await run(['export', t.path, '--style-file', `${t.dir}/nope.json`], missing)).toBe(2);
    expect(missing.stderr).toContain('Cannot read --style-file');
    const big = `${t.dir}/big.json`;
    writeFileSync(big, `{"source":{}}${' '.repeat(70 * 1024)}`);
    const io = createTestIo();
    expect(await run(['export', t.path, '--style-file', big], io)).toBe(2);
    expect(io.stderr).toContain('larger than 64 KB');
  });

  test('the font loader serves only catalog files', async () => {
    expect((await loadFontFile('literata-regular.ttf')).byteLength).toBe(95_372);
    await expect(loadFontFile('../../../etc/passwd')).rejects.toThrow(/Unknown font file/);
  });
});

describe('translate and hints save the style in the project', () => {
  let server: MockProvider | undefined;
  afterEach(() => server?.stop());

  test('translate --style-file --attribution persists both and exports with them', async () => {
    server = startMockProvider();
    const { dir, input } = workDirWithFixture();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const style = `${dir}/style.json`;
    writeFileSync(style, JSON.stringify({ preset: 'learner', hint: { color: '#1f7a8c', fontSizePercent: 65 } }));
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: 'sk-test' } });
    const args = ['translate', input, '--to', 'vi', '--provider', 'custom', '--base-url', server.url, '--model', 'mock-model', '--yes'];
    expect(await run([...args, '--style-file', style, '--attribution', '--out', `${dir}/out.epub`], io)).toBe(0);
    const project = await loadProjectFile(new Uint8Array(readFileSync(`${input}.epubtrans`)));
    expect(project.settings.exportStyle).toEqual({ preset: 'learner', hint: { color: '#1f7a8c', fontSizePercent: 65 } });
    expect(project.settings.attribution).toBe(true);
    const files = readZip(new Uint8Array(readFileSync(`${dir}/out.epub`)));
    expect(text(files, 'OEBPS/epubtrans.css')).toContain('color: #1f7a8c');
    expect(files.has('OEBPS/epubtrans-attribution.xhtml')).toBe(true);
  });
});
