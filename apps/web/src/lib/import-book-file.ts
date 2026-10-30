import { detectLanguage, importBook, loadProjectFile, type Project } from '@epubtrans/core';
import { browserDomEnv } from './dom-env';

/** Hard cap on input size; larger files would exhaust memory in the browser. */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.epub', '.mobi', '.azw3', '.azw', '.fb2', '.zip', '.epubtrans'];

export type ImportErrorKind = 'drm' | 'unsupported' | 'empty' | 'project' | 'tooLarge' | 'generic';

export class BookImportError extends Error {
  override readonly name = 'BookImportError';
  constructor(
    readonly kind: ImportErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export const isProjectFileName = (name: string): boolean => /\.epubtrans$/i.test(name);

/** Maps core's import errors to user-facing categories. */
export function classifyImportError(err: unknown, projectFile: boolean): BookImportError {
  if (err instanceof BookImportError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/DRM/i.test(message)) return new BookImportError('drm', message);
  if (projectFile) return new BookImportError('project', message);
  if (/unsupported|neither an EPUB|PalmDOC|empty or truncated|KF8 book structure/i.test(message)) return new BookImportError('unsupported', message);
  if (/No translatable text/i.test(message)) return new BookImportError('empty', message);
  return new BookImportError('generic', message);
}

/** Reads a book (EPUB/MOBI/AZW3/FB2) or an `.epubtrans` project file into a Project. */
export async function readProjectFromFile(file: File): Promise<Project> {
  const projectFile = isProjectFileName(file.name);
  try {
    if (file.size > MAX_FILE_BYTES) throw new BookImportError('tooLarge', `${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (projectFile) return await loadProjectFile(bytes);
    const project = await importBook(bytes, file.name, browserDomEnv());
    const detected = detectLanguage(project);
    if (detected !== 'und') project.settings.sourceLang = detected;
    return project;
  } catch (err) {
    throw classifyImportError(err, projectFile);
  }
}
