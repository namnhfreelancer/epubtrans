import { redactSecrets } from '@epubtrans/core';
import rootPackage from '../../../package.json';
import { UsageError } from './args';
import { exportCommand } from './commands/export';
import { glossaryCommand } from './commands/glossary';
import { hintsCommand } from './commands/hints';
import { modelsCommand } from './commands/models';
import { presetsCommand } from './commands/presets';
import { resumeCommand } from './commands/resume';
import { sampleCommand } from './commands/sample';
import { translateCommand } from './commands/translate';
import { COMMAND_HELP, MAIN_HELP } from './help';
import type { Io } from './io';
import { EXIT } from './pipeline';
import { terminalSafeIo } from './terminal-text';

export const VERSION: string = rootPackage.version;

type Command = (argv: string[], io: Io) => Promise<number> | number;
const COMMANDS: Record<string, Command> = {
  translate: translateCommand,
  resume: resumeCommand,
  sample: sampleCommand,
  hints: hintsCommand,
  export: exportCommand,
  glossary: glossaryCommand,
  models: modelsCommand,
  presets: presetsCommand,
};

/**
 * Dispatches argv (without the runtime and script path) and returns the exit code; never throws.
 * All output goes through `terminalSafeIo`: books, project files, model answers and price catalogs are untrusted.
 */
export async function run(argv: string[], rawIo: Io): Promise<number> {
  const io = terminalSafeIo(rawIo);
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.out(MAIN_HELP);
    return name === undefined ? EXIT.usage : EXIT.ok;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    io.out(`${VERSION}\n`);
    return EXIT.ok;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.err(`Unknown command "${name}". Run "epubtrans --help".\n`);
    return EXIT.usage;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(COMMAND_HELP[name] ?? MAIN_HELP);
    return EXIT.ok;
  }
  try {
    return await command(rest, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`Error: ${redactSecrets(err.message)}\nRun "epubtrans ${name} --help" for usage.\n`);
      return EXIT.usage;
    }
    if (io.signal.aborted) {
      io.err('Interrupted.\n');
      return EXIT.interrupted;
    }
    io.err(`Error: ${redactSecrets(err instanceof Error ? err.message : String(err))}\n`);
    return EXIT.failure;
  }
}
