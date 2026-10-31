import { createDefaultSettings, detectLanguage, importBook, loadProjectFile, type Project, type ProjectSettings } from '@epubtrans/core';
import { UsageError } from '../args';
import { domEnv } from '../dom-env';
import type { Io } from '../io';
import { countStatuses } from '../progress';
import { parseLanguage } from '../settings';
import { PROJECT_EXTENSION } from './output-paths';
import { readBytes } from './translate';

export interface OpenedProject {
  project: Project;
  projectPath: string;
  settings: ProjectSettings;
  existing: boolean;
}

/**
 * Loads the project (a `.epubtrans` input, or the file saved next to a book by an earlier command) or imports the
 * book into a new one. A new project needs a target language (`to`, else `defaultTo`); `usage` is shown when it is missing.
 */
export async function openProject(
  input: string,
  flags: { project?: string; to?: string; from?: string; defaultTo?: string },
  io: Io,
  usage: string,
): Promise<OpenedProject> {
  const isProjectFile = input.toLowerCase().endsWith(PROJECT_EXTENSION);
  const projectPath = isProjectFile ? input : (flags.project ?? `${input}${PROJECT_EXTENSION}`);
  const existingBytes = await readBytes(projectPath, 'project file');
  if (isProjectFile && !existingBytes) throw new UsageError(`Project file not found: ${input}`);

  if (existingBytes) {
    let project: Project;
    try {
      project = await loadProjectFile(existingBytes);
    } catch (err) {
      throw new UsageError(`${projectPath} is not a valid epubtrans project: ${err instanceof Error ? err.message : String(err)}`);
    }
    const c = countStatuses(project);
    io.err(`Using ${projectPath}: ${c.done}/${c.total} segments already translated\n`);
    if (flags.to !== undefined && parseLanguage(flags.to, '--to').toLowerCase() !== project.settings.targetLang.toLowerCase()) {
      throw new UsageError(`${projectPath} translates to "${project.settings.targetLang}", not "${flags.to}". Use another --project path or delete that file.`);
    }
    const settings = { ...project.settings };
    if (flags.from !== undefined) settings.sourceLang = flags.from === 'auto' ? 'auto' : parseLanguage(flags.from, '--from');
    return { project, projectPath, settings, existing: true };
  }

  const to = flags.to ?? flags.defaultTo;
  if (to === undefined) throw new UsageError(`--to <language> is required for a new project. Usage: ${usage}`);
  const bytes = await readBytes(input, 'input file');
  if (!bytes) throw new UsageError(`Input file not found: ${input}`);
  io.err(`Importing ${input} ...\n`);
  const project = await importBook(bytes, input.split(/[\\/]/).pop() ?? input, domEnv);
  io.err(`Imported "${project.title}": ${project.chapters.length} chapters, ${countStatuses(project).total} segments\n`);
  const requestedFrom = flags.from === undefined || flags.from === 'auto' ? 'auto' : parseLanguage(flags.from, '--from');
  const detected = requestedFrom === 'auto' ? detectLanguage(project) : requestedFrom;
  const settings = createDefaultSettings({ sourceLang: detected === 'und' ? 'auto' : detected, targetLang: parseLanguage(to, '--to') });
  return { project, projectPath, settings, existing: false };
}
