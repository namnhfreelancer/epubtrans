import { estimateTokens } from '../translate/token-estimate';

/**
 * Largest paragraph a converted text book keeps whole, in estimated tokens. A segment is one block element, and its
 * translation must fit one model answer (at most 8192 output tokens, roughly three times the source as a budget), so
 * a longer paragraph could never be translated: every attempt would be cut off and fail validation.
 */
export const MAX_SEGMENT_TOKENS = 2000;

/** End of a sentence: terminal punctuation (and closing quotes or brackets) before a space; CJK stops need no space. */
const SENTENCE_END = /[.!?…]+["'”’»)\]]*\s+|[。！？]+[」』”’）)]*\s*/gu;

/** Splits text at sentence ends; every piece keeps its trailing whitespace, so joining the pieces gives the text back. */
function sentences(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > start) pieces.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

/** A piece with no sentence end inside: split at spaces, and a run without spaces into fixed-size slices. */
function words(piece: string, maxTokens: number): string[] {
  return piece.split(/(?<=\s)/u).flatMap((word) => {
    if (estimateTokens(word) <= maxTokens) return [word];
    // maxTokens characters are at most maxTokens tokens in every script (CJK is the densest, 1.5 characters a token).
    const slices: string[] = [];
    for (let i = 0; i < word.length; ) {
      let end = Math.min(word.length, i + maxTokens);
      // Never cut a surrogate pair in half.
      const code = word.charCodeAt(end);
      if (end < word.length && code >= 0xdc00 && code <= 0xdfff) end--;
      slices.push(word.slice(i, end));
      i = end;
    }
    return slices;
  });
}

/**
 * Splits a paragraph longer than `maxTokens` into consecutive parts of at most `maxTokens`, cutting at sentence ends
 * (else at spaces, else anywhere). Shorter text comes back unchanged as the only part. Parts are trimmed.
 */
export function splitLongText(text: string, maxTokens = MAX_SEGMENT_TOKENS): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const parts: string[] = [];
  let current = '';
  let tokens = 0;
  for (const sentence of sentences(text)) {
    for (const piece of estimateTokens(sentence) > maxTokens ? words(sentence, maxTokens) : [sentence]) {
      const pieceTokens = estimateTokens(piece);
      if (current && tokens + pieceTokens > maxTokens) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        tokens = 0;
      }
      current += piece;
      tokens += pieceTokens;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
