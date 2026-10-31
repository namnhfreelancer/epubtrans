import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readZip, writeZip } from '../../../packages/core/src/util/zip-archive';
import { run } from '../src/run';
import { stripTerminalControls, terminalSafe } from '../src/terminal-text';
import { createTestIo, startMockProvider, workDirWithFixture } from './test-helpers';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

describe('stripTerminalControls', () => {
  test('removes escape sequences whole and control characters, keeping text, newlines and tabs', () => {
    expect(stripTerminalControls('EVIL\x1b]0;PWNED-TITLE\x07\x1b[2J after')).toBe('EVIL after');
    expect(stripTerminalControls('copy\x1b]52;c;ZXZpbA==\x1b\\ done')).toBe('copy done');
    expect(stripTerminalControls('a\x9b31mred\x9d0;t\x9c b')).toBe('ared b');
    expect(stripTerminalControls('x\x1bcy\x1b(Bz')).toBe('xyz');
    expect(stripTerminalControls('over\rwrite\x7f\x08\x00 bell\x07')).toBe('overwrite bell');
    expect(stripTerminalControls('line 1\n\tline 2 — Đà Nẵng 孙悟空 😀')).toBe('line 1\n\tline 2 — Đà Nẵng 孙悟空 😀');
    // An unterminated string control loses only its introducer.
    expect(stripTerminalControls('a\x1b]0;title')).toBe('a0;title');
  });

  test('terminalSafe keeps the CLI progress redraw prefix only', () => {
    expect(terminalSafe('\r\x1b[Ktranslate 1/2')).toBe('\r\x1b[Ktranslate 1/2');
    expect(terminalSafe('\r\x1b[Kx\x1b[2J')).toBe('\r\x1b[Kx');
    expect(terminalSafe('title\r\x1b[K')).toBe('title');
  });
});

/** A copy of the fixture book whose first paragraph carries an OSC title change, a BEL and a clear-screen sequence. */
function hostileBook(): { dir: string; input: string } {
  const work = workDirWithFixture();
  const files = readZip(new Uint8Array(readFileSync(work.input)));
  const doc = [...files.keys()].find((k) => /\.x?html$/.test(k) && new TextDecoder().decode(files.get(k)).includes('<p'));
  if (!doc) throw new Error('fixture has no paragraph');
  const html = new TextDecoder().decode(files.get(doc)).replace(/<p([^>]*)>/, '<p$1>EVIL&#x1b;]0;PWNED-TITLE&#x7;&#x1b;[2J ');
  files.set(doc, new TextEncoder().encode(html));
  writeFileSync(work.input, writeZip(files));
  return work;
}

describe('untrusted text on the terminal', () => {
  test('the sample report never prints escape sequences from the book or the model', async () => {
    const server = startMockProvider();
    const work = hostileBook();
    cleanup.push(
      () => server.stop(),
      () => rmSync(work.dir, { recursive: true, force: true }),
    );
    const io = createTestIo({ env: { EPUBTRANS_API_KEY: 'k' } });
    const argv = ['sample', work.input, '--to', 'vi', '--passages', '50', '--words', '5000', '--provider', 'custom', '--base-url', server.url];
    const code = await run([...argv, '--model', 'm', '--yes', '--no-price-lookup'], io);
    expect(code).toBe(0);
    expect(io.stdout).toContain('EVIL');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting that no control character is printed.
    const control = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
    expect(io.stdout).not.toMatch(control);
    expect(io.stderr).not.toMatch(control);
    expect(io.stdout).not.toContain('PWNED-TITLE');
  });
});
