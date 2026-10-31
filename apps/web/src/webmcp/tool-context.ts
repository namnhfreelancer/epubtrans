import type { DomEnv, Project } from '@epubtrans/core';
import { en } from '../i18n/messages-en';
import type { Locale, Translate } from '../i18n/translate-message';
import { apiKeys } from '../lib/api-key-store';
import { repository } from '../lib/app-services';
import { isJobRunningElsewhere } from '../lib/cross-tab-job-lock';
import { browserDomEnv } from '../lib/dom-env';
import { downloadBytes } from '../lib/download-file';
import { isGuideJobRunning } from '../lib/guide-jobs';
import { navigate, type Route } from '../lib/hash-route';
import { ensureProject } from '../lib/project-store';
import { estimateRunCost, lookupRunPricing, type RunPrices, resolveRunPrices } from '../lib/run-pricing';
import { getSampleJobState } from '../lib/sample-jobs';
import { isJobActive } from '../lib/translation-jobs';
import type { ActiveProviderState } from '../lib/use-active-provider';
import { fail, type ToolFailure } from './tool-result';

/** Browser services the tool handlers use, injected so unit tests can run them without a page. */
export interface ToolContext {
  /** Translates into the current UI language (confirm dialogs are shown to the user, not the agent). */
  t: Translate;
  /** The current UI language, for number formatting in confirm dialogs. */
  locale(): Locale;
  /** Shows a blocking confirmation to the user; false when declined or when the browser suppresses dialogs. */
  confirm(message: string): boolean;
  /** Moves the app to a route so the user sees what the agent did. */
  navigate(route: Route): void;
  download(bytes: Uint8Array, fileName: string, mimeType: string): void;
  domEnv(): DomEnv;
  fetch(input: string, init: RequestInit): Promise<Response>;
  /** Values that must never appear in a tool output (the stored API keys). */
  secrets(): string[];
}

/** The real browser services; `t` follows the UI language through the getter. */
export function browserToolContext(getI18n: () => { t: Translate; locale: Locale }): ToolContext {
  return {
    t: (key, params) => getI18n().t(key, params),
    locale: () => getI18n().locale,
    confirm: (message) => window.confirm(message),
    navigate,
    download: downloadBytes,
    domEnv: browserDomEnv,
    fetch: (input, init) => window.fetch(input, init),
    secrets: () => Object.values(apiKeys.store.get().keys).filter(Boolean),
  };
}

/** English text of an app message key, for tool outputs (tool names, descriptions and outputs stay English). */
export const englishMessage = (key: keyof typeof en): string => en[key];

export const BOOK_NOT_FOUND_HINT = 'Call list_books to get valid book ids.';

/** Loads a book by id, or a failure the agent can act on. */
export async function findBook(bookId: string): Promise<Project | ToolFailure> {
  try {
    if (!(await repository.exists(bookId))) return fail(`No book with id "${bookId.slice(0, 80)}".`, BOOK_NOT_FOUND_HINT);
    return await ensureProject(bookId);
  } catch (err) {
    return fail(`Could not load the book: ${err instanceof Error ? err.message : String(err)}`, BOOK_NOT_FOUND_HINT);
  }
}

export const isFailure = (value: unknown): value is ToolFailure =>
  typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false && typeof (value as { error?: unknown }).error === 'string';

/** Why the book cannot take another paid job or a segment change right now, or undefined when it can. */
export type BusyReason = 'job-running' | 'sample-running' | 'guide-running' | 'busy-elsewhere';

export async function busyReason(projectId: string, opts: { ignoreGuide?: boolean } = {}): Promise<BusyReason | undefined> {
  if (isJobActive(projectId)) return 'job-running';
  if (getSampleJobState(projectId).status === 'running') return 'sample-running';
  if (!opts.ignoreGuide && isGuideJobRunning(projectId)) return 'guide-running';
  if (await isJobRunningElsewhere(projectId)) return 'busy-elsewhere';
  return undefined;
}

const BUSY_TEXT: Record<BusyReason, { error: string; hint: string }> = {
  'job-running': { error: 'A translation run is in progress for this book.', hint: 'Wait for it (poll get_book_status) or call pause_translation first.' },
  'sample-running': { error: 'A sample translation is in progress for this book.', hint: 'Wait until it finishes, then try again.' },
  'guide-running': { error: 'Guideline and glossary generation is in progress for this book.', hint: 'Wait until it finishes, then try again.' },
  'busy-elsewhere': {
    error: 'This book is being translated in another browser tab.',
    hint: 'Ask the user to pause it in that tab or wait until it finishes.',
  },
};

export const busyFailure = (reason: BusyReason): ToolFailure => fail(BUSY_TEXT[reason].error, BUSY_TEXT[reason].hint);

/** A failure for a provider that is not ready, in English, telling the agent what the user must do. */
export function providerFailure(provider: ActiveProviderState): ToolFailure | undefined {
  if (!provider.problem) return undefined;
  return fail(englishMessage(provider.problem), 'The user must finish the provider setup in Settings (API keys and the custom endpoint are user-only).');
}

/**
 * Where the estimate's prices came from: entered in the book's settings (they may come from an imported project
 * file), looked up automatically (the provider's model list or the public catalogs), or not known.
 */
export type PriceSource = 'book-settings' | 'looked-up' | 'unknown';

/** The remaining work's estimate as reported to agents; `usd` is null when no price is known for the model. */
export interface AgentEstimate {
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
  priceSource: PriceSource;
  /** USD per 1M input/output tokens used for `usd`; absent when no price is known. */
  pricesPerM?: { input: number; output: number };
}

/** Prices as the setup page's cost card resolves them: manual book prices, else the provider's list, else the public catalogs. */
export async function resolveAgentPrices(project: Project, provider: ActiveProviderState, signal?: AbortSignal): Promise<RunPrices> {
  const { active } = provider;
  const published = active.priceInPerM !== undefined && active.priceOutPerM !== undefined;
  return resolveRunPrices(project.settings, active, published ? undefined : await lookupRunPricing(active, signal));
}

export const roundUsd = (usd: number | undefined): number | null => (usd === undefined ? null : Math.round(usd * 10_000) / 10_000);

/** The same estimate of the remaining work as the setup page's cost card. */
export async function estimateRemaining(project: Project, provider: ActiveProviderState, signal?: AbortSignal): Promise<AgentEstimate> {
  const prices = await resolveAgentPrices(project, provider, signal);
  const estimate = estimateRunCost(project, provider.active, prices);
  const { priceInPerM, priceOutPerM } = prices;
  const known = estimate.usd !== undefined && priceInPerM !== undefined && priceOutPerM !== undefined;
  return {
    inputTokens: estimate.inputTokens,
    outputTokens: estimate.outputTokens,
    usd: roundUsd(estimate.usd),
    priceSource: !known ? 'unknown' : prices.manual ? 'book-settings' : 'looked-up',
    ...(known ? { pricesPerM: { input: priceInPerM, output: priceOutPerM } } : {}),
  };
}
