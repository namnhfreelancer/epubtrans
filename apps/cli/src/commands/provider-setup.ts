import { type ChatProvider, createProvider, type ReasoningLevel } from '@epubtrans/core';
import { requireApiKey, resolveApiKey } from '../api-key';
import type { Io } from '../io';
import type { ProviderSelection } from '../settings';

/**
 * Builds the chat provider for a selection. The key comes from the environment or a key file
 * (see api-key.ts) and is only passed on to the provider adapter, never printed.
 * `custom` endpoints (Ollama, LM Studio, local proxies) may run without a key.
 */
export async function buildProvider(
  selection: ProviderSelection,
  keyFile: string | undefined,
  model: string,
  io: Io,
  opts: { keyOptional?: boolean; reasoning?: ReasoningLevel } = {},
): Promise<ChatProvider> {
  const optional = opts.keyOptional === true || selection.preset.id === 'custom';
  const keyOpts = { genericAllowed: selection.genericKeyAllowed };
  const resolved = optional ? await resolveApiKey(selection.preset.id, keyFile, io, keyOpts) : await requireApiKey(selection.preset.id, keyFile, io, keyOpts);
  if (resolved) io.err(`Using API key from ${resolved.source}\n`);
  return createProvider(selection.preset, resolved?.key ?? '', selection.baseURL, model, undefined, { reasoning: opts.reasoning });
}
