import { readFile } from 'node:fs/promises';
import { UsageError } from './args';
import type { Io } from './io';

/** Provider-specific environment variables, consulted after `EPUBTRANS_API_KEY`. */
export const PROVIDER_KEY_ENV: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
};

export const GENERIC_KEY_ENV = 'EPUBTRANS_API_KEY';

export interface ResolvedKey {
  /** The secret. Never log it; use `source` for messages. */
  key: string;
  /** Human-readable origin such as "env OPENAI_API_KEY". */
  source: string;
}

/** A key must be a single token: this rejects pasted multi-line content and values with stray spaces. */
function cleanKey(raw: string, origin: string): string {
  const key = raw.trim();
  if (!key) throw new UsageError(`${origin} is empty`);
  if (/\s/.test(key)) throw new UsageError(`${origin} must contain a single API key without whitespace`);
  return key;
}

export interface KeyOptions {
  /**
   * Whether `EPUBTRANS_API_KEY` may be used for this provider. False when a shared project file chose the
   * provider: the generic key must not be handed to a provider the user did not pick on this run.
   */
  genericAllowed?: boolean;
}

function candidateEnvNames(providerId: string, genericAllowed: boolean): string[] {
  return [...(genericAllowed ? [GENERIC_KEY_ENV] : []), ...(PROVIDER_KEY_ENV[providerId] ?? [])];
}

/**
 * Precedence: `--api-key-file` (use `-` for stdin), then `EPUBTRANS_API_KEY` (only when `genericAllowed`,
 * the default), then the provider's own variable. Returns undefined when nothing is configured; callers
 * decide whether a key is required. When the generic key is the only one set but is not allowed, fails
 * with an explanation instead of silently ignoring it.
 */
export async function resolveApiKey(
  providerId: string,
  keyFile: string | undefined,
  io: Pick<Io, 'env' | 'readStdin'>,
  { genericAllowed = true }: KeyOptions = {},
): Promise<ResolvedKey | undefined> {
  if (keyFile !== undefined) {
    let raw: string;
    try {
      raw = keyFile === '-' ? await io.readStdin() : await readFile(keyFile, 'utf8');
    } catch (err) {
      throw new UsageError(`Cannot read --api-key-file ${keyFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { key: cleanKey(raw, `API key file ${keyFile === '-' ? '(stdin)' : keyFile}`), source: `file ${keyFile}` };
  }
  for (const name of candidateEnvNames(providerId, genericAllowed)) {
    const value = io.env[name];
    if (value !== undefined && value.trim() !== '') return { key: cleanKey(value, `Environment variable ${name}`), source: `env ${name}` };
  }
  if (!genericAllowed && (io.env[GENERIC_KEY_ENV] ?? '').trim() !== '') {
    const own = PROVIDER_KEY_ENV[providerId]?.[0];
    throw new UsageError(
      `The provider "${providerId}" comes from the project file, so ${GENERIC_KEY_ENV} is not sent to it (a shared project file must not choose who receives your key). ` +
        `${own ? `Set ${own}, pass` : 'Pass'} --api-key-file <path>, or pass --provider ${providerId} to confirm the provider and use ${GENERIC_KEY_ENV}.`,
    );
  }
  return undefined;
}

/** Like `resolveApiKey` but fails with setup instructions when no key is configured. */
export async function requireApiKey(
  providerId: string,
  keyFile: string | undefined,
  io: Pick<Io, 'env' | 'readStdin'>,
  opts: KeyOptions = {},
): Promise<ResolvedKey> {
  const resolved = await resolveApiKey(providerId, keyFile, io, opts);
  if (resolved) return resolved;
  const names = candidateEnvNames(providerId, opts.genericAllowed ?? true).join(', ');
  throw new UsageError(`No API key for provider "${providerId}". Set ${names ? `one of ${names}` : 'a key variable'}, or pass --api-key-file <path>.`);
}
