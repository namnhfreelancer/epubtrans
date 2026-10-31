import { promptLine } from './prompt';

/** Everything the commands need from the process, injectable so tests run without spawning. */
export interface Io {
  out(text: string): void;
  err(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  /** stdin is a terminal, so a confirmation prompt can be answered. */
  interactive: boolean;
  /** stderr is a terminal: progress is redrawn in place. */
  progressInPlace: boolean;
  prompt(question: string): Promise<string>;
  readStdin(): Promise<string>;
  /** Aborted by Ctrl-C (SIGINT/SIGTERM). */
  signal: AbortSignal;
  /** Transport for the public price lookup (no credentials); defaults to the global fetch. Injectable for tests. */
  fetch?: typeof fetch;
}

export function createProcessIo(signal: AbortSignal, onInterrupt: () => void): Io {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    env: process.env,
    interactive: Boolean(process.stdin.isTTY),
    progressInPlace: Boolean(process.stderr.isTTY),
    prompt: (question) => promptLine(question, { input: process.stdin, output: process.stderr, signal, onInterrupt }),
    readStdin: () => Bun.stdin.text(),
    signal,
  };
}
