import { EXPORT_MODES, GUIDELINE_PRESETS, PROVIDER_PRESETS } from '@epubtrans/core';
import { GENERIC_KEY_ENV, PROVIDER_KEY_ENV } from '../api-key';
import { UsageError } from '../args';
import type { Io } from '../io';

const pad = (s: string, n: number) => s.padEnd(n);

/** Lists provider presets, guideline presets and export modes accepted by the other commands. */
export function presetsCommand(argv: string[], io: Io): number {
  if (argv.length > 0) throw new UsageError('epubtrans presets takes no arguments');
  io.out('Providers (--provider <id>)\n');
  for (const p of PROVIDER_PRESETS) {
    const env = PROVIDER_KEY_ENV[p.id]?.join(', ') ?? GENERIC_KEY_ENV;
    io.out(`  ${pad(p.id, 11)}${pad(p.baseURL || '(pass --base-url)', 56)}key: ${env}\n`);
  }
  io.out(`\nAll providers also read ${GENERIC_KEY_ENV} when --provider is passed on the run, or --api-key-file <path>.\n`);
  io.out('\nGuideline presets (--guideline-preset <id>)\n');
  for (const g of GUIDELINE_PRESETS) io.out(`  ${pad(g.id, 11)}${g.label}\n`);
  io.out(`\nExport modes (--mode <mode>)\n  ${EXPORT_MODES.join('\n  ')}\n`);
  return 0;
}
