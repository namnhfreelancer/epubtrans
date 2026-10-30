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

/**
 * Precedence: `--api-key-file` (use `-` for stdin), then `EPUBTRANS_API_KEY`, then the provider's own variable.
 * Returns undefined when nothing is configured; callers decide whether a key is required.
 */
export async function resolveApiKey(providerId: string, keyFile: string | undefined, io: Pick<Io, 'env' | 'readStdin'>): Promise<ResolvedKey | undefined> {
  if (keyFile !== undefined) {
    let raw: string;
    try {
      raw = keyFile === '-' ? await io.readStdin() : await readFile(keyFile, 'utf8');
    } catch (err) {
      throw new UsageError(`Cannot read --api-key-file ${keyFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { key: cleanKey(raw, `API key file ${keyFile === '-' ? '(stdin)' : keyFile}`), source: `file ${keyFile}` };
  }
  for (const name of [GENERIC_KEY_ENV, ...(PROVIDER_KEY_ENV[providerId] ?? [])]) {
    const value = io.env[name];
    if (value !== undefined && value.trim() !== '') return { key: cleanKey(value, `Environment variable ${name}`), source: `env ${name}` };
  }
  return undefined;
}

/** Like `resolveApiKey` but fails with setup instructions when no key is configured. */
export async function requireApiKey(providerId: string, keyFile: string | undefined, io: Pick<Io, 'env' | 'readStdin'>): Promise<ResolvedKey> {
  const resolved = await resolveApiKey(providerId, keyFile, io);
  if (resolved) return resolved;
  const names = [GENERIC_KEY_ENV, ...(PROVIDER_KEY_ENV[providerId] ?? [])].join(', ');
  throw new UsageError(`No API key for provider "${providerId}". Set one of ${names}, or pass --api-key-file <path>.`);
}
