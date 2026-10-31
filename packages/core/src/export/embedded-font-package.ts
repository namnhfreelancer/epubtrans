import type { PackageInfo } from '../epub/package-document';
import type { EmbeddedFont, FontFileLoader } from '../export-style/embedded-fonts';
import { FONT_DIR } from '../export-style/export-style-css';
import type { FileMap } from '../util/zip-archive';
import { dirname } from '../util/zip-path';
import { addManifestItem } from './manifest-items';

/**
 * Font media types. EPUB 3.3 lists `font/ttf` as a core media type. EPUB 2 (OPF 2.0.1) predates registered font types;
 * `application/x-font-truetype` is the long-standing name its reading systems and epubcheck accept.
 */
const TTF_MEDIA_TYPE = { epub3: 'font/ttf', epub2: 'application/x-font-truetype' } as const;

/** A TrueType file starts with the sfnt version 1.0 (`00 01 00 00`) or `true`. */
function isTrueType(bytes: Uint8Array): boolean {
  const head = Array.from(bytes.subarray(0, 4)).join(',');
  return head === '0,1,0,0' || head === '116,114,117,101';
}

/** A license file is plain text: not empty, not markup (a web server's HTML error page, for instance). */
const isPlainText = (bytes: Uint8Array): boolean => bytes.length > 0 && !new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().startsWith('<');

export interface LoadedFontFiles {
  fonts: readonly EmbeddedFont[];
  /** File name → bytes, for every face and license of `fonts`. */
  files: Map<string, Uint8Array>;
}

/** Loads (and checks) every file of the given fonts. Throws when a loader is missing or returns something else. */
export async function loadEmbeddedFontFiles(fonts: readonly EmbeddedFont[], loader: FontFileLoader | undefined): Promise<LoadedFontFiles> {
  const files = new Map<string, Uint8Array>();
  if (fonts.length === 0) return { fonts, files };
  if (!loader) throw new Error(`The export style embeds ${fonts.map((f) => f.family).join(', ')}, but no font files are available here`);
  await Promise.all(
    fonts.flatMap((font) => [
      ...font.faces.map(async (face) => {
        const bytes = await loader(face.file);
        if (!isTrueType(bytes)) throw new Error(`Font file ${face.file} is not a TrueType font`);
        files.set(face.file, bytes);
      }),
      (async () => {
        const bytes = await loader(font.licenseFile);
        if (!isPlainText(bytes)) throw new Error(`License file ${font.licenseFile} is not plain text`);
        files.set(font.licenseFile, bytes);
      })(),
    ]),
  );
  return { fonts, files };
}

/**
 * Writes the fonts and their OFL license files into `epubtrans-fonts/` next to the stylesheet and lists them in the
 * manifest of every package that lists the stylesheet (fonts plainly, never obfuscated).
 */
export function packageEmbeddedFonts(files: FileMap, pkgs: readonly PackageInfo[], cssPath: string, loaded: LoadedFontFiles, epub2: boolean): void {
  const dir = `${dirname(cssPath) ? `${dirname(cssPath)}/` : ''}${FONT_DIR}`;
  for (const font of loaded.fonts) {
    for (const face of font.faces) {
      const path = `${dir}/${face.file}`;
      files.set(path, loaded.files.get(face.file) as Uint8Array);
      for (const pkg of pkgs)
        addManifestItem(pkg, `epubtrans-font-${face.file.replace(/\.ttf$/, '')}`, path, epub2 ? TTF_MEDIA_TYPE.epub2 : TTF_MEDIA_TYPE.epub3);
    }
    const license = `${dir}/${font.licenseFile}`;
    files.set(license, loaded.files.get(font.licenseFile) as Uint8Array);
    for (const pkg of pkgs) addManifestItem(pkg, `epubtrans-font-license-${font.id}`, license, 'text/plain');
  }
}
