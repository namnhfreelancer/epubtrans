import { type BuiltResource, RES_DIR } from '../epub/build-epub-package';
import { sniffMediaType } from '../util/media-type';

/**
 * Collects binary resources (images, fonts, stylesheets) for a converted book and
 * hands out stable file names. Returned hrefs are relative to OEBPS/text/ and OEBPS/res/
 * alike (`../res/<name>`), so they work from chapters and from stylesheets.
 */
export class ResourceRegistry {
  readonly resources: BuiltResource[] = [];
  private readonly byKey = new Map<string, string>();

  /** Registers `data` under `key`; returns its href, or undefined for unsupported media. */
  add(key: string, data: Uint8Array, mediaType?: string, isCover = false): string | undefined {
    const known = this.byKey.get(key);
    if (known) {
      if (isCover) this.markCover(known);
      return `../${RES_DIR}/${known}`;
    }
    const sniffed = sniffMediaType(data);
    const type = mediaType ?? sniffed?.mediaType;
    const extension = mediaType ? extensionOf(mediaType) : sniffed?.extension;
    if (!type || !extension) return undefined;
    const fileName = `${key.replace(/[^A-Za-z0-9_-]/g, '-')}.${extension}`;
    this.byKey.set(key, fileName);
    this.resources.push({ fileName, mediaType: type, data, isCover: isCover && type.startsWith('image/') });
    return `../${RES_DIR}/${fileName}`;
  }

  private markCover(fileName: string): void {
    const res = this.resources.find((r) => r.fileName === fileName);
    if (res?.mediaType.startsWith('image/')) res.isCover = true;
  }
}

const EXTENSIONS: Record<string, string> = {
  'text/css': 'css',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function extensionOf(mediaType: string): string | undefined {
  return EXTENSIONS[mediaType];
}
