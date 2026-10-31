import { readFile, stat } from 'node:fs/promises';
import { ExportStyleError, loadProjectFile, MAX_STYLE_FILE_BYTES, type Project, type ProjectSettings, parseStyleFile } from '@epubtrans/core';
import { UsageError } from './args';
import type { Io } from './io';

/** Tells the user which keys of a file this version did not know and left out (the file came from a newer version). */
function warnIgnoredKeys(io: Io, what: string, keys: readonly string[]): void {
  if (keys.length === 0) return;
  const list = keys.map((k) => JSON.stringify(k)).join(', ');
  io.err(`Warning: ${what}: ignored settings this version of epubtrans does not know (written by a newer version?): ${list}\n`);
}

/**
 * Reads `--style-file`: a style object or a style template file exported by the web app (exactly one template). Core
 * validates it with the same rules and turns it into the same `epubtrans.css` as in the web app. Invalid values are a
 * usage error; unknown keys are left out with a warning.
 */
export async function readStyleFile(path: string, io: Io): Promise<NonNullable<ProjectSettings['exportStyle']>> {
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
    const { style, ignoredKeys } = parseStyleFile(text);
    warnIgnoredKeys(io, `--style-file ${path}`, ignoredKeys);
    return style;
  } catch (err) {
    if (err instanceof ExportStyleError) throw new UsageError(`--style-file ${path}: ${err.message}`);
    throw err;
  }
}

/** Style flags a command may take; `--attribution` and `--no-attribution` exclude each other. */
export interface StyleFlagValues {
  'style-file'?: string;
  attribution?: boolean;
  'no-attribution'?: boolean;
}

/**
 * `--style-file`, `--attribution` and `--no-attribution` over the project's settings; unchanged when none is given.
 * The caller decides whether the result is saved (translate, resume, hints) or used for one export only (export).
 */
export async function applyStyleFlags(settings: ProjectSettings, flags: StyleFlagValues, io: Io): Promise<ProjectSettings> {
  if (flags.attribution && flags['no-attribution']) throw new UsageError('--attribution and --no-attribution cannot be used together');
  const file = flags['style-file'];
  const exportStyle = file === undefined ? undefined : await readStyleFile(file, io);
  const { attribution: _attribution, ...rest } = settings;
  const attribution = flags.attribution ? true : flags['no-attribution'] ? false : settings.attribution;
  return {
    ...rest,
    ...(exportStyle !== undefined ? { exportStyle } : {}),
    ...(attribution === true ? { attribution: true } : {}),
  };
}

/** Reads a project file; export style keys a newer version wrote are left out with a warning instead of failing. */
export async function loadProjectFileWithWarnings(bytes: Uint8Array, path: string, io: Io): Promise<Project> {
  const ignored: string[] = [];
  const project = await loadProjectFile(bytes, { onIgnoredKey: (key) => ignored.push(key) });
  warnIgnoredKeys(io, path, ignored);
  return project;
}
