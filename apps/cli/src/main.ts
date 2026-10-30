#!/usr/bin/env bun
import { createProcessIo } from './io';
import { run } from './run';

// Ctrl-C aborts the running translation so the project file is flushed before exit; a second Ctrl-C quits at once.
const interrupt = new AbortController();
let interrupts = 0;
const onSignal = () => {
  interrupts++;
  if (interrupts > 1) process.exit(130);
  process.stderr.write('\nStopping, saving progress (press Ctrl-C again to quit immediately) ...\n');
  interrupt.abort();
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

process.exitCode = await run(process.argv.slice(2), createProcessIo(interrupt.signal));
// stdin may still be open after a confirmation prompt; do not keep the process alive for it.
process.exit();
