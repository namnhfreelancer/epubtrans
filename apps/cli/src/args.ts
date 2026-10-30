/**
 * Minimal argv parser: `--flag value`, `--flag=value`, boolean switches, a few short aliases and `--`.
 * Flag types are declared per command so values are validated at the boundary.
 */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export interface FlagSpec {
  type: 'string' | 'number' | 'boolean';
  /** Single-letter alias, used as `-y`. */
  short?: string;
}
export type FlagSpecs = Record<string, FlagSpec>;

type FlagValue<T extends FlagSpec> = T['type'] extends 'string' ? string : T['type'] extends 'number' ? number : boolean;
/** Flags the user did not pass are `undefined`; boolean switches are only ever `true`. */
export type ParsedFlags<S extends FlagSpecs> = { [K in keyof S]?: FlagValue<S[K]> };

export interface ParsedArgs<S extends FlagSpecs> {
  positionals: string[];
  flags: ParsedFlags<S>;
}

/** Secrets must never travel through argv: they leak into `ps`, shell history and CI logs. */
const SECRET_FLAGS = new Set(['api-key', 'apikey', 'key', 'token', 'secret']);

export function parseArgs<S extends FlagSpecs>(argv: readonly string[], specs: S): ParsedArgs<S> {
  const positionals: string[] = [];
  const flags: Record<string, string | number | boolean> = {};
  const byShort = new Map(Object.entries(specs).flatMap(([name, spec]) => (spec.short ? [[spec.short, name] as const] : [])));

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
      i = consume(name, inline, i);
    } else if (arg.length === 2 && arg.startsWith('-') && byShort.has(arg.slice(1))) {
      i = consume(byShort.get(arg.slice(1)) as string, undefined, i);
    } else if (arg.length > 1 && arg.startsWith('-') && !/^-\d/.test(arg)) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags: flags as ParsedFlags<S> };

  /** Reads the value of flag `name` (starting after argv[index]); returns the index of the last token used. */
  function consume(name: string, inline: string | undefined, index: number): number {
    if (SECRET_FLAGS.has(name)) {
      throw new UsageError(
        `--${name} is not accepted: a key on the command line leaks into shell history and process lists. Set EPUBTRANS_API_KEY or use --api-key-file <path>.`,
      );
    }
    const spec = specs[name];
    if (!spec) throw new UsageError(`Unknown option: --${name}`);
    if (spec.type === 'boolean') {
      if (inline !== undefined && inline !== 'true') throw new UsageError(`--${name} does not take a value`);
      flags[name] = true;
      return index;
    }
    let raw = inline;
    let used = index;
    if (raw === undefined) {
      const next = argv[index + 1];
      const isNegativeNumber = spec.type === 'number' && next !== undefined && /^-\d/.test(next);
      if (next === undefined || (next.startsWith('-') && next.length > 1 && !isNegativeNumber)) throw new UsageError(`--${name} needs a value`);
      raw = next;
      used = index + 1;
    }
    if (spec.type === 'string') {
      flags[name] = raw;
    } else {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) throw new UsageError(`--${name} must be a number, got "${raw}"`);
      flags[name] = value;
    }
    return used;
  }
}

/** Exactly `count` positional arguments, otherwise a usage error naming what is missing. */
export function expectPositionals(positionals: string[], count: number, usage: string): string[] {
  if (positionals.length < count) throw new UsageError(`Missing argument. Usage: ${usage}`);
  if (positionals.length > count) throw new UsageError(`Unexpected argument "${positionals[count]}". Usage: ${usage}`);
  return positionals;
}
