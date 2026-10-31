import { describe, expect, it } from 'vitest';
import { exportEpub } from '../src';
import { readZip } from '../src/util/zip-archive';
import { addManifestItems, browserLikeEnv, dec, enc, expectNoActiveMarkup, poisonedProject } from './package-markup-test-helpers';
import { env } from './test-helpers';

/** Elements an HTML parser would create with an event handler when it reads the markup. */
const liveHandlers = (markup: string) => new env.DOMParser().parseFromString(markup, 'text/html').querySelectorAll('[onerror]').length;

const encryptionXml = (...uris: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${uris
    .map(
      (uri) =>
        `<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>`,
    )
    .join('')}</encryption>`;

/**
 * Bytes of an obfuscated font whose first stored byte happens to be `<` (font byte XOR key byte):
 * the rest is binary, with a tag-like run a markup sanitizer would remove.
 */
const obfuscatedFont = new Uint8Array([
  ...enc('<\u0001'),
  0x9a,
  0x00,
  ...enc('<script>s</script>'),
  ...Array.from({ length: 512 }, (_, i) => (i * 37 + 11) & 0xff),
]);

describe('content-based markup detection leaves opaque and non-markup resources alone', () => {
  it('keeps obfuscated fonts listed in encryption.xml and CSS starting with <!-- byte-identical', async () => {
    const css = '<!--\nbody { color: #333 }\np { margin: 0 }\n-->\n';
    const project = await poisonedProject((files) => {
      files.set('OEBPS/fonts/sans.ttf', obfuscatedFont);
      // An unknown extension: only its encryption.xml entry marks it as opaque bytes.
      files.set('OEBPS/fonts/serif.font', obfuscatedFont);
      files.set('OEBPS/legacy.css', enc(css));
      files.set('META-INF/encryption.xml', enc(encryptionXml('OEBPS/fonts/sans.ttf', 'OEBPS/fonts/serif.font')));
      addManifestItems(
        files,
        '<item href="fonts/sans.ttf" id="sans" media-type="font/ttf"/><item href="fonts/serif.font" id="serif" media-type="application/vnd.ms-opentype"/><item href="legacy.css" id="legacy" media-type="text/css"/>',
      );
    });
    const source = readZip(project.sourceEpub);
    for (const domEnv of [env, browserLikeEnv]) {
      const files = readZip(await exportEpub(project, 'bilingual', domEnv));
      for (const path of ['OEBPS/fonts/sans.ttf', 'OEBPS/fonts/serif.font', 'OEBPS/legacy.css', 'META-INF/encryption.xml']) {
        expect(files.get(path), path).toEqual(source.get(path));
      }
    }
  });

  it('still sanitizes an unknown-extension file that is not listed in encryption.xml', async () => {
    const project = await poisonedProject((files) => {
      files.set('OEBPS/fonts/serif.font', enc('<doc><script>console.log("PWN-font")</script><p>kept</p></doc>'));
      files.set('META-INF/encryption.xml', enc(encryptionXml('OEBPS/fonts/other.ttf')));
      addManifestItems(files, '<item href="fonts/serif.font" id="serif" media-type="application/vnd.ms-opentype"/>');
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const out = await exportEpub(project, 'bilingual', domEnv);
      expectNoActiveMarkup(out);
      expect(dec(readZip(out).get('OEBPS/fonts/serif.font') ?? new Uint8Array())).toContain('kept');
    }
  });

  it('rewrites a file recognized only by content so it carries no comment, PI or CDATA section', async () => {
    const dat =
      '<?x a="><img src=x onerror=alert(3)>"?><div><style><!--</style><img src="x" onerror="alert(1)"/>--></style><p><![CDATA[ a > <img src=y onerror=alert(2)> ]]></p></div>';
    // The repro is real: an HTML parser reading the source file creates the event handlers.
    expect(liveHandlers(dat)).toBeGreaterThan(0);
    const project = await poisonedProject((files) => {
      files.set('OEBPS/note.dat', enc(dat));
      addManifestItems(files, '<item href="note.dat" id="note" media-type="application/octet-stream"/>');
    });
    for (const domEnv of [env, browserLikeEnv]) {
      const text = dec(readZip(await exportEpub(project, 'bilingual', domEnv)).get('OEBPS/note.dat') ?? new Uint8Array());
      expect(text).not.toBe(dat);
      expect(text).toContain('<div>');
      for (const trick of ['<!--', '<![CDATA[', '<?x a=']) expect(text, trick).not.toContain(trick);
      expect(liveHandlers(text)).toBe(0);
    }
  });
});
