import { strToU8 } from 'fflate';
import { type FileMap, writeEpubZip } from '../src/util/zip-archive';

const XHTML11 = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
export const EPUB2_IDENTIFIER = 'urn:uuid:0b6a3f0e-1c55-4b7a-8a51-3f6f1d2b9c10';

const chapter = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
${XHTML11}
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head><title>${title}</title></head><body>${body}</body></html>
`;

/**
 * A small, valid EPUB 2 book (OPF 2.0.1, NCX, XHTML 1.1 chapters) with ordinary English prose, a list and a heading.
 * `extra` adds or replaces files (an encryption.xml, for instance) before zipping.
 */
export function buildEpub2Book(extra: FileMap = new Map()): Uint8Array {
  const prose =
    'It is a melancholy object to those who walk through this great town or travel in the country, when they see the streets, the roads and cabin doors crowded with beggars.';
  const files: FileMap = new Map([
    ['mimetype', strToU8('application/epub+zip')],
    [
      'META-INF/container.xml',
      strToU8(
        '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
      ),
    ],
    [
      'OEBPS/content.opf',
      strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>An EPUB 2 Sample</dc:title>
<dc:creator opf:role="aut">A. Writer</dc:creator>
<dc:language>en</dc:language>
<dc:identifier id="bookid" opf:scheme="UUID">${EPUB2_IDENTIFIER}</dc:identifier>
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>
`),
    ],
    [
      'OEBPS/toc.ncx',
      strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${EPUB2_IDENTIFIER}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>An EPUB 2 Sample</text></docTitle>
<navMap><navPoint id="n1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="c1.xhtml"/></navPoint><navPoint id="n2" playOrder="2"><navLabel><text>Chapter Two</text></navLabel><content src="c2.xhtml"/></navPoint></navMap>
</ncx>
`),
    ],
    [
      'OEBPS/c1.xhtml',
      strToU8(
        chapter(
          'Chapter One',
          `<h1>Chapter One</h1><p>${prose}</p><p>The mothers, instead of being able to work for their honest livelihood, are forced to employ all their time.</p>`,
        ),
      ),
    ],
    [
      'OEBPS/c2.xhtml',
      strToU8(
        chapter('Chapter Two', `<h2>Chapter Two</h2><ul><li>A short list item about the kingdom.</li><li>Another item.</li></ul><p><em>${prose}</em></p>`),
      ),
    ],
  ]);
  for (const [path, data] of extra) files.set(path, data);
  return writeEpubZip(files);
}
