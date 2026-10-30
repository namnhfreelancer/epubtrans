/**
 * Compiles the CLI into single-file binaries with `bun build --compile` and writes dist/SHA256SUMS.
 *
 *   bun scripts/build-cli.ts --host           binary for this machine
 *   bun scripts/build-cli.ts --all            every release target
 *   bun scripts/build-cli.ts linux-x64 ...    selected targets
 *
 * Output: <repo>/dist/epubtrans-<os>-<arch>[.exe]
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64'] as const;
type Target = (typeof TARGETS)[number];

const root = resolve(import.meta.dir, '..');
const entry = join(root, 'apps/cli/src/main.ts');
const distDir = join(root, 'dist');

const isTarget = (value: string): value is Target => (TARGETS as readonly string[]).includes(value);

function hostTarget(): Target {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  const target = `${os}-${process.arch}`;
  if (!isTarget(target)) throw new Error(`No release target for ${target}; supported: ${TARGETS.join(', ')}`);
  return target;
}

function parseTargets(args: string[]): Target[] {
  if (args.length === 0) throw new Error('Usage: bun scripts/build-cli.ts --host | --all | <target>...');
  const picked = new Set<Target>();
  for (const arg of args) {
    if (arg === '--all') for (const t of TARGETS) picked.add(t);
    else if (arg === '--host') picked.add(hostTarget());
    else if (isTarget(arg)) picked.add(arg);
    else throw new Error(`Unknown target "${arg}"; supported: ${TARGETS.join(', ')}`);
  }
  return [...picked];
}

async function compile(target: Target): Promise<string> {
  const name = `epubtrans-${target}${target.startsWith('windows') ? '.exe' : ''}`;
  const outfile = join(distDir, name);
  const proc = Bun.spawn([process.execPath, 'build', '--compile', '--minify', `--target=bun-${target}`, entry, '--outfile', outfile], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`bun build failed for ${target} (exit ${code})`);
  return name;
}

/** Checksums cover every epubtrans-* binary currently in dist/, in `sha256sum` format. */
async function writeChecksums(): Promise<void> {
  const names = (await readdir(distDir)).filter((n) => n.startsWith('epubtrans-')).sort();
  const lines = await Promise.all(
    names.map(async (name) => {
      const hash = new Bun.CryptoHasher('sha256').update(await Bun.file(join(distDir, name)).arrayBuffer()).digest('hex');
      return `${hash}  ${name}`;
    }),
  );
  await Bun.write(join(distDir, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

const targets = parseTargets(process.argv.slice(2));
await mkdir(distDir, { recursive: true });
await rm(join(distDir, 'SHA256SUMS'), { force: true });
for (const target of targets) console.log(`built ${await compile(target)}`);
await writeChecksums();
console.log(`wrote ${join(distDir, 'SHA256SUMS')}`);
