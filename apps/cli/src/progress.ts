import type { Project, TokenUsage, TranslationProgress } from '@epubtrans/core';
import type { Io } from './io';

export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatUsd(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export function usageCost(usage: TokenUsage, priceInPerM?: number, priceOutPerM?: number): number | undefined {
  if (priceInPerM === undefined || priceOutPerM === undefined) return undefined;
  return (usage.input * priceInPerM + usage.output * priceOutPerM) / 1e6;
}

/** Progress of a phase: translation phases, or another label such as "hints". */
export type PhaseProgress = Omit<TranslationProgress, 'phase'> & { phase: string };

export interface Progress {
  update(p: PhaseProgress): void;
  /** Ends the in-place line so later output starts on a fresh row. */
  finish(): void;
}

/**
 * Progress on stderr (stdout stays clean). On a terminal the line is redrawn in place; otherwise
 * (CI, pipes) a line is printed at most every `plainIntervalMs` and when a phase completes.
 */
export function createProgress(io: Io, prices: { priceInPerM?: number; priceOutPerM?: number }, plainIntervalMs = 10_000): Progress {
  const startedAt = Date.now();
  let lastPlain = 0;
  let drewInPlace = false;

  const line = (p: PhaseProgress): string => {
    const pct = p.total ? Math.floor((p.done / p.total) * 100) : 100;
    const cost = usageCost(p.usage, prices.priceInPerM, prices.priceOutPerM);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const eta = p.done > 0 && p.done < p.total ? ` eta ${Math.round((elapsed / p.done) * (p.total - p.done))}s` : '';
    return `${p.phase} ${p.done}/${p.total} (${pct}%) | in ${formatTokens(p.usage.input)} out ${formatTokens(p.usage.output)} tokens${cost === undefined ? '' : ` | ${formatUsd(cost)}`} | ${elapsed}s${eta}`;
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
}

export function countStatuses(project: Project): StatusCounts {
  const counts: StatusCounts = { total: 0, done: 0, pending: 0, error: 0 };
  for (const chapter of project.chapters) {
    for (const s of chapter.segments) {
      counts.total++;
      if (s.status === 'pending') counts.pending++;
      else if (s.status === 'error') counts.error++;
      else counts.done++;
    }
  }
  return counts;
}
