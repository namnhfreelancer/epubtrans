import type { ChatProvider, GlossaryEntry, Project, ProjectSettings } from '../types';
import { buildContextBlock, extractJson } from './prompt-protocol';
import { withRetry } from './retry-with-backoff';
import { estimateTokens } from './token-estimate';

const SAMPLE_TOKENS = 6000;
const MAX_GLOSSARY = 150;

/** Spreads a text sample across the whole book so the glossary covers more than chapter one. */
export function sampleBookText(project: Project, maxTokens = SAMPLE_TOKENS): string {
  const all = project.chapters.flatMap((c) => c.segments.map((s) => s.sourceText)).filter(Boolean);
  if (all.length === 0) return '';
  const total = all.reduce((n, t) => n + estimateTokens(t), 0);
  const stride = Math.max(1, Math.ceil(total / maxTokens));
  const picked: string[] = [];
  let tokens = 0;
  for (let i = 0; i < all.length && tokens < maxTokens; i += stride) {
    const text = all[i] as string;
    picked.push(text);
    tokens += estimateTokens(text);
  }
  return picked.join('\n');
}

/**
 * Asks the model for a book-specific style guideline and glossary, starting from the
 * current settings (preset guideline and existing glossary are refined, not discarded).
 */
export async function generateGuide(
  project: Project,
  provider: ChatProvider,
  settings: ProjectSettings,
  signal?: AbortSignal,
): Promise<{ guideline: string; glossary: GlossaryEntry[] }> {
  const system = `You are a translation editor preparing a book translation. Write a concise style guideline (tone, register, forms of address, recurring stylistic choices; at most 12 bullet points) and a glossary of names, recurring terms and concepts that must be translated consistently.

${buildContextBlock(settings)}

## Output
Refine the current guideline and glossary above for this specific book; keep entries that are still valid. Write the guideline in English. Answer with JSON only:
{"guideline":"- …","glossary":[{"term":"source term","translation":"target term","note":"optional short note"}]}`;
  const user = `Book: ${project.title}${project.author ? ` by ${project.author}` : ''}\n\nSample text:\n${sampleBookText(project)}`;
  const res = await withRetry(() => provider.chat({ system, user, maxTokens: 4096, signal }), signal);
  return parseGuide(res.text);
}

export function parseGuide(text: string): { guideline: string; glossary: GlossaryEntry[] } {
  const json = extractJson(text) as { guideline?: unknown; glossary?: unknown };
  if (typeof json?.guideline !== 'string' || !json.guideline.trim()) throw new Error('model answer has no guideline');
  const glossary: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(json.glossary) ? json.glossary : []) {
    const { term, translation, note } = (item ?? {}) as Record<string, unknown>;
    if (typeof term !== 'string' || typeof translation !== 'string' || !term.trim() || !translation.trim()) continue;
    const key = term.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    glossary.push({ term: term.trim(), translation: translation.trim(), ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}) });
    if (glossary.length >= MAX_GLOSSARY) break;
  }
  return { guideline: json.guideline.trim(), glossary };
}
