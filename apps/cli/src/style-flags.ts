import { readFile, stat } from 'node:fs/promises';
import { ExportStyleError, MAX_STYLE_FILE_BYTES, type ProjectSettings, parseStyleFile } from '@epubtrans/core';
import { UsageError } from './args';

/**
 * Reads `--style-file`: a style object or a style template file exported by the web app (exactly one template). Core
 * validates it with the same strict rules and turns it into the same `epubtrans.css` as in the web app.
 */
export async function readStyleFile(path: string): Promise<NonNullable<ProjectSettings['exportStyle']>> {
  let text: string;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new UsageError(`--style-file ${path} is not a file`);
    if (info.size > MAX_STYLE_FILE_BYTES) throw new UsageError(`--style-file ${path} is larger than ${MAX_STYLE_FILE_BYTES / 1024} KB`);
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`Cannot read --style-file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return parseStyleFile(text);
  } catch (err) {
    if (err instanceof ExportStyleError) throw new UsageError(`--style-file ${path}: ${err.message}`);
    throw err;
  }
}

/** `--style-file` and `--attribution` over the project's settings; unchanged when neither is given. */
export async function applyStyleFlags(settings: ProjectSettings, flags: { 'style-file'?: string; attribution?: boolean }): Promise<ProjectSettings> {
  const file = flags['style-file'];
  const exportStyle = file === undefined ? undefined : await readStyleFile(file);
  return {
    ...settings,
    ...(exportStyle !== undefined ? { exportStyle } : {}),
    ...(flags.attribution === true ? { attribution: true } : {}),
  };
}
