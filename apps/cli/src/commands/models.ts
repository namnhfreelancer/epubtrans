import { parseArgs, UsageError } from '../args';
import { MODELS_FLAGS } from '../flag-specs';
import type { Io } from '../io';
import { selectProvider } from '../settings';
import { buildProvider } from './provider-setup';

/** Prints the model ids from the provider's /models endpoint, one per line on stdout. */
export async function modelsCommand(argv: string[], io: Io): Promise<number> {
  const { positionals, flags } = parseArgs(argv, MODELS_FLAGS);
  if (positionals.length > 0) throw new UsageError(`Unexpected argument "${positionals[0]}". Usage: epubtrans models [--provider <id>] [--base-url <url>]`);
  const selection = selectProvider(flags);
  // Some endpoints list models publicly (OpenRouter, local servers): a missing key is not an error here.
  const provider = await buildProvider(selection, flags['api-key-file'], '', io, { keyOptional: true });
  const models = await provider.listModels(io.signal);
  if (models.length === 0) io.err('The provider returned no models.\n');
  for (const id of models) io.out(`${id}\n`);
  return 0;
}
