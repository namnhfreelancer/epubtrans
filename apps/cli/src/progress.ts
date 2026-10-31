import { type Project, type TokenUsage, type TranslationProgress, type UsagePricing, usageCostUsd } from '@epubtrans/core';
import type { Io } from './io';

export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatUsd(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** USD for the tokens used; cached input is priced at its discount (see core `usageCostUsd`). */
export const usageCost = (usage: TokenUsage, pricing: UsagePricing): number | undefined => usageCostUsd(usage, pricing);

/** "in 12.3k (8.1k cached) out 4.0k": cached tokens (part of the input) are shown separately when the provider reports them. */
export function formatUsage(usage: TokenUsage): string {
  const cached = cachedPart(usage);
  return `in ${formatTokens(usage.input)}${cached ? ` (${cached})` : ''} out ${formatTokens(usage.output)}`;
}

const cachedPart = (usage: TokenUsage): string =>
  [usage.cachedInput ? `${formatTokens(usage.cachedInput)} cached` : '', usage.cacheWriteInput ? `${formatTokens(usage.cacheWriteInput)} cache write` : '']
    .filter(Boolean)
    .join(', ');

/** "Tokens used: 12.3k in (8.1k cached) / 4.0k out ($0.0123)" after a run. */
export function tokensUsedLine(usage: TokenUsage, pricing: UsagePricing): string {
  const cost = usageCost(usage, pricing);
  const cached = cachedPart(usage);
  return `Tokens used: ${formatTokens(usage.input)} in${cached ? ` (${cached})` : ''} / ${formatTokens(usage.output)} out${cost === undefined ? '' : ` (${formatUsd(cost)})`}\n`;
}

export interface Progress {
  update(p: TranslationProgress): void;
  /** Ends the in-place line so later output starts on a fresh row. */
  finish(): void;
}

/**
 * Progress on stderr (stdout stays clean). On a terminal the line is redrawn in place; otherwise
 * (CI, pipes) a line is printed at most every `plainIntervalMs` and when a phase completes.
 */
export function createProgress(io: Io, pricing: UsagePricing, plainIntervalMs = 10_000): Progress {
  const startedAt = Date.now();
  let lastPlain = 0;
  let drewInPlace = false;

  const line = (p: TranslationProgress): string => {
    const pct = p.total ? Math.floor((p.done / p.total) * 100) : 100;
    const cost = usageCost(p.usage, pricing);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const eta = p.done > 0 && p.done < p.total ? ` eta ${Math.round((elapsed / p.done) * (p.total - p.done))}s` : '';
    return `${p.phase} ${p.done}/${p.total} (${pct}%) | ${formatUsage(p.usage)} tokens${cost === undefined ? '' : ` | ${formatUsd(cost)}`} | ${elapsed}s${eta}`;
  };

  return {
    update(p) {
      if (io.progressInPlace) {
        drewInPlace = true;
        io.err(`\r\x1b[K${line(p)}`);
        return;
      }
      const now = Date.now();
      if (p.done < p.total && now - lastPlain < plainIntervalMs) return;
      lastPlain = now;
      io.err(`${line(p)}\n`);
    },
    finish() {
      if (drewInPlace) io.err('\n');
      drewInPlace = false;
    },
  };
}

export interface StatusCounts {
  total: number;
  done: number;
  pending: number;
  error: number;
  /** Translated segments flagged as identical to their source (a warning; they still count as done). */
  identical: number;
}

export function countStatuses(project: Project): StatusCounts {
  const counts: StatusCounts = { total: 0, done: 0, pending: 0, error: 0, identical: 0 };
  for (const chapter of project.chapters) {
    for (const s of chapter.segments) {
      counts.total++;
      if (s.warning === 'identical' && s.status !== 'error') counts.identical++;
      if (s.status === 'pending') counts.pending++;
      else if (s.status === 'error') counts.error++;
      else counts.done++;
    }
  }
  return counts;
}

/** Summary line for translations identical to their source, or '' when there are none. Lists up to five ids. */
export function identicalWarningLine(project: Project): string {
  const ids = project.chapters.flatMap((c) => c.segments.filter((s) => s.warning === 'identical' && s.status !== 'error').map((s) => s.id));
  if (ids.length === 0) return '';
  const shown = ids.slice(0, 5).join(', ');
  return `Warning: ${ids.length} translations are identical to the source (${shown}${ids.length > 5 ? ', ...' : ''}); they are exported as they are. Check them in the web app's reader, or turn the check off with --identical-min-letters 0.\n`;
}
