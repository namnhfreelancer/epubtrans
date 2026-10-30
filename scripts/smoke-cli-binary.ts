/**
 * Smoke test for a compiled CLI binary (no network, no API key needed):
 * builds a partly translated project from a core fixture, then runs `--version`, `presets` and
 * `export` (all three modes) through the binary and checks each EPUB starts with a stored `mimetype`.
 *
 *   bun scripts/smoke-cli-binary.ts [path/to/epubtrans-binary]    (default: the host binary in dist/)
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { domEnv } from '../apps/cli/src/dom-env';
import { EXPORT_MODES, importBook, saveProjectFile } from '../packages/core/src';

const root = resolve(import.meta.dir, '..');
const os = process.platform === 'win32' ? 'windows' : process.platform;
const defaultBinary = join(root, 'dist', `epubtrans-${os}-${process.arch}${os === 'windows' ? '.exe' : ''}`);
const binary = resolve(process.argv[2] ?? defaultBinary);

async function exec(args: string[]): Promise<string> {
  const proc = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${binary} ${args.join(' ')} exited with ${code}\n${stderr}`);
  return stdout + stderr;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`smoke test failed: ${message}`);
}

function firstZipEntry(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0, true) === 0x04034b50, 'output is not a zip archive');
  return new TextDecoder().decode(bytes.subarray(30, 30 + view.getUint16(26, true)));
}

const work = await mkdtemp(join(tmpdir(), 'epubtrans-smoke-'));
try {
  const fixture = join(root, 'packages/core/test/fixtures/a-modest-proposal.epub');
  const project = await importBook(new Uint8Array(await readFile(fixture)), 'a-modest-proposal.epub', domEnv);
  project.settings.targetLang = 'vi';
  for (const segment of project.chapters.flatMap((c) => c.segments).slice(0, 5)) {
    segment.translationHtml = `<p>[vi] ${segment.sourceText}</p>`;
    segment.status = 'translated';
  }
  const projectPath = join(work, 'smoke.epubtrans');
  await Bun.write(projectPath, await saveProjectFile(project));

  const version = (await exec(['--version'])).trim();
  assert(/^\d+\.\d+\.\d+/.test(version), `unexpected --version output "${version}"`);
  assert((await exec(['presets'])).includes('openrouter'), 'presets did not list openrouter');

  for (const mode of EXPORT_MODES) {
    const out = join(work, `${mode}.epub`);
    await exec(['export', projectPath, '--mode', mode, '--out', out]);
    assert(firstZipEntry(new Uint8Array(await readFile(out))) === 'mimetype', `${mode}: first zip entry is not mimetype`);
  }
  console.log(`smoke test passed: ${binary} (version ${version})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
