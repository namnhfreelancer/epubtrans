import type { Io } from './io';

/**
 * Terminal escape sequences: CSI (ESC [ or C1 CSI ... final byte), string controls terminated by BEL or ST
 * (OSC ESC ], DCS ESC P, SOS ESC X, PM ESC ^, APC ESC _, and their C1 forms), and the remaining two-byte ESC forms.
 * An unterminated string control only loses its introducer; its text stays visible, which is harmless.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose of this pattern.
const ESCAPE_SEQUENCE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)|\x1b[ -/]*[0-~]/g;
/** C0 controls except tab and newline, DEL, and C1 controls. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the purpose of this pattern.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/**
 * Removes everything a terminal would interpret instead of print (escape sequences, control characters other than
 * tab and newline, carriage returns included), so text from a book, a project file, a model or a remote catalog
 * cannot retitle the terminal, clear the screen, hide output or write the clipboard (OSC 52).
 */
export function stripTerminalControls(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '').replace(CONTROL, '');
}

/** The only control sequence the CLI itself writes: redraw the progress line in place. */
const PROGRESS_REDRAW = '\r\x1b[K';

/** `stripTerminalControls`, keeping a leading progress redraw written by the CLI's own progress printer. */
export function terminalSafe(text: string): string {
  if (text.startsWith(PROGRESS_REDRAW)) return PROGRESS_REDRAW + stripTerminalControls(text.slice(PROGRESS_REDRAW.length));
  return stripTerminalControls(text);
}

/**
 * Wraps `io` so that everything printed on stdout and stderr is terminal-safe. Applied once around every command,
 * so no book-, project-, model- or catalog-derived string can reach the terminal raw, whichever message carries it.
 */
export function terminalSafeIo(io: Io): Io {
  return { ...io, out: (text) => io.out(terminalSafe(text)), err: (text) => io.err(terminalSafe(text)) };
}
