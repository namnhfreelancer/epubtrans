import { strToU8 } from 'fflate';
import { type FileMap, writeEpubZip } from '../src/util/zip-archive';

/** The identifier the package's `unique-identifier` names: the second `dc:identifier`, after an ISBN. */
export const FIXED_LAYOUT_IDENTIFIER = 'urn:uuid:7c1f4b2a-9d3e-4a6b-8f0c-2e5d7a9b1c3d';
export const FIXED_LAYOUT_ISBN = 'urn:isbn:9780000000002';

const page = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><title>${title}</title><meta name="viewport" content="width=600, height=800"/></head>
<body>${body}</body>
</html>
`;

/**
 * A small, valid fixed-layout EPUB 3 book (`rendition:layout` pre-paginated, a viewport on every page), like a comic or
 * a picture book. Its `unique-identifier` names the second of two `dc:identifier`s, so tests can tell it apart from
 * "the first identifier".
 */
export function buildFixedLayoutBook(): Uint8Array {
  const files: FileMap = new Map([
    ['mimetype', strToU8('application/epub+zip')],
    [
      'META-INF/container.xml',
      strToU8(
        '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
      ),
    ],
    [
      'OEBPS/package.opf',
      strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="isbn">${FIXED_LAYOUT_ISBN}</dc:identifier>
<dc:identifier id="pub-id">${FIXED_LAYOUT_IDENTIFIER}</dc:identifier>
<dc:title>A Fixed-Layout Sample</dc:title>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2026-10-31T00:00:00Z</meta>
<meta property="rendition:layout">pre-paginated</meta>
<meta property="rendition:orientation">portrait</meta>
<meta property="rendition:spread">none</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
<item id="p2" href="p2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="p1"/><itemref idref="p2"/></spine>
</package>
`),
    ],
    [
      'OEBPS/nav.xhtml',
      strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="p1.xhtml">The Fox</a></li><li><a href="p2.xhtml">The Crow</a></li></ol></nav></body>
</html>
`),
    ],
    [
      'OEBPS/p1.xhtml',
      strToU8(page('The Fox', '<h1>The Fox</h1><p>A hungry fox saw some fine bunches of grapes hanging from a vine high above the ground.</p>')),
    ],
    [
      'OEBPS/p2.xhtml',
      strToU8(page('The Crow', '<h1>The Crow</h1><p>A crow, half dead with thirst, came upon a pitcher which had once been full of water.</p>')),
    ],
  ]);
  return writeEpubZip(files);
}
