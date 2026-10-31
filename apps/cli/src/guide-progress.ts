import type { GuideProgress } from '@epubtrans/core';
import type { Io } from './io';

/**
 * Prints `generateGuide` progress on stderr: one line when a phase starts and, while classifying glossary
 * candidates, one line per finished batch ("Classifying glossary candidates: 160/480").
 */
export function createGuideProgressPrinter(io: Io): (p: GuideProgress) => void {
  return (p) => {
    if (p.phase === 'extract' && p.done === 0) io.err('Scanning the book for names and terms ...\n');
    else if (p.phase === 'guideline' && p.done === 0) io.err('Writing the style guideline from passages across the book ...\n');
    else if (p.phase === 'glossary' && p.total > 0) io.err(`Classifying glossary candidates: ${p.done}/${p.total}\n`);
  };
}
