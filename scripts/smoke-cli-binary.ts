/**
 * Smoke test for a compiled CLI binary (no network, no API key needed):
 * builds a partly translated project with Word Wise hints from a core fixture, then runs `--version`, `presets`,
 * `export` (every mode, plus `original --word-wise`, plus a `--style-file` export that embeds a bundled font) and
 * `hints` through the binary and checks each EPUB starts with a stored `mimetype` (and the styled one holds the font,
 * which proves the font files are inside the binary). `hints` on a project whose words are all glossed only loads the embedded frequency
 * list and stops before any request, which proves the lists are inside the binary.
 *
 *   bun scripts/smoke-cli-binary.ts [path/to/epubtrans-binary]    (default: the host binary in dist/)
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { domEnv } from '../apps/cli/src/dom-env';
import { EXPORT_MODES, generateProjectWordHints, importBook, parseFrequencyList, planWordHints, saveProjectFile } from '../packages/core/src';
import { readZip } from '../packages/core/src/util/zip-archive';

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
  project.settings.sourceLang = 'en';
  project.settings.wordHints = { enabled: false, level: 3, style: 'ruby', maxPerParagraph: 3, perChapter: 1 };
  const list = parseFrequencyList('en', await readFile(join(root, 'packages/core/data/wordfreq/en.txt'), 'utf8'));
  const glosses = {
    listModels: async () => [],
    chat: async (req: { user: string }) => {
      const { items } = JSON.parse(req.user) as { items: { id: string; lemma: string }[] };
      return { text: JSON.stringify({ items: items.map((i) => ({ id: i.id, sense: 'main', gloss: `~${i.lemma}` })) }) };
    },
  };
  await generateProjectWordHints(project, planWordHints(project, list, project.settings), glosses, { concurrency: 4 });
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
  const hinted = join(work, 'original-hints.epub');
  await exec(['export', projectPath, '--mode', 'original', '--word-wise', '--out', hinted]);
  assert(firstZipEntry(new Uint8Array(await readFile(hinted))) === 'mimetype', 'original --word-wise: first zip entry is not mimetype');
  const styleFile = join(work, 'style.json');
  await Bun.write(styleFile, JSON.stringify({ translation: { font: 'literata', color: '#333333' } }));
  const styled = join(work, 'styled.epub');
  await exec(['export', projectPath, '--style-file', styleFile, '--attribution', '--out', styled]);
  const styledFiles = readZip(new Uint8Array(await readFile(styled)));
  assert(styledFiles.get('OEBPS/epubtrans-fonts/literata-regular.ttf')?.byteLength === 95_372, 'styled export lacks the embedded font');
  assert(styledFiles.has('OEBPS/epubtrans-attribution.xhtml'), 'styled export lacks the attribution page');
  const hints = await exec(['hints', projectPath, '--provider', 'custom', '--base-url', 'http://127.0.0.1:9', '--model', 'none', '--yes']);
  assert(hints.includes('Nothing to do'), `hints did not load the embedded frequency list:\n${hints}`);
  console.log(`smoke test passed: ${binary} (version ${version})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
