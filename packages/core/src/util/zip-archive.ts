import { strToU8, unzipSync, type Zippable, zipSync } from 'fflate';

export type FileMap = Map<string, Uint8Array>;

/** Reads every entry of a zip archive. Directory entries are dropped. */
export function readZip(bytes: Uint8Array): FileMap {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new Error(`Invalid zip archive: ${(err as Error).message}`);
  }
  const files: FileMap = new Map();
  for (const [name, data] of Object.entries(entries)) {
    if (!name.endsWith('/')) files.set(name, data);
  }
  return files;
}

const STORED_EXTENSIONS = /\.(jpe?g|png|gif|webp|woff2?|epub|zip|mp3|mp4)$/i;

/**
 * Writes a zip. Order of `files` is preserved; already-compressed media is stored.
 * Entries are written without timestamps-dependent extra fields so output is deterministic.
 */
export function writeZip(files: FileMap): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, data] of files) {
    zippable[name] = [data, { level: STORED_EXTENSIONS.test(name) ? 0 : 6 }];
  }
  return zipSync(zippable, { mtime: new Date('2000-01-01T00:00:00Z') });
}

/** Writes an EPUB OCF container: `mimetype` first and stored (uncompressed). */
export function writeEpubZip(files: FileMap): Uint8Array {
  const ordered: FileMap = new Map([['mimetype', strToU8('application/epub+zip')]]);
  for (const [name, data] of files) if (name !== 'mimetype') ordered.set(name, data);
  const zippable: Zippable = {};
  for (const [name, data] of ordered) {
    zippable[name] = [data, { level: name === 'mimetype' || STORED_EXTENSIONS.test(name) ? 0 : 6 }];
  }
  return zipSync(zippable, { mtime: new Date('2000-01-01T00:00:00Z') });
}
