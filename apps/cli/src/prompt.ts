import { createInterface } from 'node:readline/promises';

export interface PromptOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Aborting rejects the pending question (an external SIGINT/SIGTERM). */
  signal: AbortSignal;
  /** Called when Ctrl-C is typed at the prompt; the caller aborts `signal` so the command exits as interrupted. */
  onInterrupt: () => void;
  /** Force raw-mode line editing on or off; default follows whether `output` is a terminal. */
  terminal?: boolean;
}

/**
 * Asks one question on a terminal. readline in terminal mode swallows Ctrl-C and, without a `SIGINT`
 * listener, just pauses, which would leave the question pending forever. Here Ctrl-C closes the prompt,
 * notifies the caller and rejects, so the process can exit promptly.
 */
export async function promptLine(question: string, opts: PromptOptions): Promise<string> {
  const rl = createInterface({ input: opts.input, output: opts.output, ...(opts.terminal !== undefined ? { terminal: opts.terminal } : {}) });
  const interrupted = new Promise<never>((_, reject) => {
    rl.once('SIGINT', () => {
      opts.output.write('\n');
      opts.onInterrupt();
      reject(new DOMException('Prompt interrupted', 'AbortError'));
    });
  });
  try {
    return await Promise.race([rl.question(question, { signal: opts.signal }), interrupted]);
  } finally {
    rl.close();
  }
}
