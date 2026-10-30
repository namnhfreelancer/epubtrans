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
}

export function createProcessIo(signal: AbortSignal): Io {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    env: process.env,
    interactive: Boolean(process.stdin.isTTY),
    progressInPlace: Boolean(process.stderr.isTTY),
    prompt: async (question) => {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    readStdin: () => Bun.stdin.text(),
    signal,
  };
}
