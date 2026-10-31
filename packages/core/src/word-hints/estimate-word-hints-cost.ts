import { priceEstimate } from '../translate/estimate-cost';
import { estimateTokens } from '../translate/token-estimate';
import type { CostEstimate, ProjectSettings } from '../types';
import { GLOSS_BATCH_SIZE, MAX_CONTEXTS_PER_LEMMA, packBatches, planFirstRound, SAMPLE_CONTEXTS } from './generate-word-hints';
import { buildGlossSystemPrompt, buildGlossUserMessage } from './gloss-protocol';
import type { HintCandidate } from './select-hint-candidates';

/** Answer tokens per item: `{"id":"w123","sense":"river edge","gloss":"bờ sông"},` with room for a longer gloss. */
const ANSWER_TOKENS_PER_ITEM = 22;
const ANSWER_OVERHEAD = 8;
/** Share of lemmas with several occurrences whose sampled contexts disagree, so they need a second round. */
const POLYSEMOUS_SHARE = 0.2;

export interface WordHintsEstimate extends CostEstimate {
  /** Lemmas to gloss. */
  words: number;
  /** Their occurrences in the book. */
  occurrences: number;
  /** Requests of the first round (the second round adds a few). */
  requests: number;
}

/**
 * Tokens (and USD when both prices are set) for glossing `candidates` with `generateWordHints`: the first round is
 * counted exactly from the planned requests, the second round is modelled as 20% of the lemmas with more than two
 * occurrences sending up to 12 contexts each at the average item size, plus up to 12 contexts of every lemma that
 * already has senses (glossed before, with occurrences still missing).
 */
export function estimateWordHintsCost(
  candidates: readonly HintCandidate[],
  settings: Pick<ProjectSettings, 'priceInPerM' | 'priceOutPerM'>,
  langs: { sourceLang: string; glossLang: string },
): WordHintsEstimate {
  const system = estimateTokens(buildGlossSystemPrompt(langs.sourceLang, langs.glossLang));
  const batches = packBatches(planFirstRound(candidates));
  let inputTokens = 0;
  let outputTokens = 0;
  let items = 0;
  for (const batch of batches) {
    inputTokens += system + estimateTokens(buildGlossUserMessage(batch.map((p) => p.item)));
    outputTokens += ANSWER_OVERHEAD + batch.length * ANSWER_TOKENS_PER_ITEM;
    items += batch.length;
  }
  const known = candidates.filter((c) => c.senses?.length);
  if (items > 0 || known.length > 0) {
    // Without a first round (only lemmas with known senses) an item costs about its context: ~60 tokens.
    const perItem = items > 0 ? (inputTokens - batches.length * system) / items : 60;
    const extra = candidates
      .filter((c) => !c.senses?.length && c.occurrences.length > SAMPLE_CONTEXTS)
      .reduce((n, c) => n + Math.min(c.occurrences.length, MAX_CONTEXTS_PER_LEMMA) - SAMPLE_CONTEXTS, 0);
    // Lemmas glossed before send their missing occurrences (up to 12) straight to the second round.
    const knownItems = known.reduce((n, c) => n + Math.min(c.occurrences.length, MAX_CONTEXTS_PER_LEMMA), 0);
    const secondItems = Math.round(extra * POLYSEMOUS_SHARE) + knownItems;
    // Second-round items also carry the known senses (about 15 tokens).
    inputTokens += Math.round(secondItems * (perItem + 15) + Math.ceil(secondItems / GLOSS_BATCH_SIZE) * system);
    outputTokens += secondItems * ANSWER_TOKENS_PER_ITEM;
  }
  return {
    ...priceEstimate(inputTokens, outputTokens, settings),
    words: candidates.length,
    occurrences: candidates.reduce((n, c) => n + c.occurrences.length, 0),
    requests: batches.length,
  };
}
