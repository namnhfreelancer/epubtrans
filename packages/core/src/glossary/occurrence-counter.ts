/** A candidate found by a local extractor: `positions` holds up to two `[paragraph, offset]` pairs for context snippets. */
export interface RawCandidate {
  term: string;
  count: number;
  positions: number[];
}

/** Counts keys and remembers where the first two occurrences (in different paragraphs) are. */
export class OccurrenceCounter {
  readonly counts = new Map<string, number>();
  readonly positions = new Map<string, number[]>();

  add(key: string, paragraph: number, offset: number, times = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + times);
    const known = this.positions.get(key);
    if (!known) this.positions.set(key, [paragraph, offset]);
    else if (known.length === 2 && known[0] !== paragraph) known.push(paragraph, offset);
  }

  /** Adds every occurrence of `key` in `other` under `as`. */
  merge(other: OccurrenceCounter, key: string, as: string): void {
    const count = other.counts.get(key) ?? 0;
    if (count === 0) return;
    const pos = other.positions.get(key) ?? [];
    this.add(as, pos[0] ?? 0, pos[1] ?? 0, count);
    if (pos.length === 4) {
      const known = this.positions.get(as);
      if (known?.length === 2 && known[0] !== pos[2]) known.push(pos[2] as number, pos[3] as number);
    }
  }

  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}

/** Sorts by count (descending), then term, so equal input always gives equal output. */
export const byCountThenTerm = (a: { term: string; count: number }, b: { term: string; count: number }): number =>
  b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);
