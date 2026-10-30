/**
 * Starting style guidelines. They are language-pair agnostic: the language pair is added
 * by the system prompt. `technical` and `psychology` are generalized from the v2 prompts.
 */
export type GuidelinePresetId = 'general' | 'fiction' | 'technical' | 'psychology';

export interface GuidelinePreset {
  id: GuidelinePresetId;
  label: string;
  guideline: string;
}

const GENERAL = `- Translate meaning, not words: write the way a skilled native author of the target language would.
- Keep the author's tone, register and level of formality; do not simplify or embellish.
- Keep names of people and places as commonly rendered in the target language; otherwise keep them unchanged.
- Translate idioms with natural equivalents; keep cultural references and add no explanations of your own.
- Use terminology consistently across the whole book.`;

const FICTION = `- Prioritize a natural, immersive reading experience: rhythm, voice and emotion matter as much as accuracy.
- Give every character a consistent voice; keep dialogue lively and idiomatic, matching age, class and mood.
- Preserve wordplay, imagery and humor with creative equivalents when a literal rendering would fall flat.
- Keep names, honorifics and forms of address consistent; choose pronouns that fit the relationships between characters.
- Do not add, cut or explain content; preserve paragraph breaks, emphasis and dialogue punctuation conventions of the target language.`;

const TECHNICAL = `- Audience: software engineers and IT professionals. Absolute technical accuracy comes first.
- Keep programming and technology terms in English when practitioners of the target language normally use them (API, framework, class, function, deployment, DevOps, Agile, Continuous Delivery, cloud, infrastructure, metrics, platform).
- For new or complex terms, keep the English term; on first use you may add a short target-language gloss in parentheses.
- Never translate code, identifiers, commands, file names, URLs or configuration keys.
- Write professional but accessible prose: no word-for-word translation, no overly formal style, no unnecessary mixing of languages.
- Localize idioms and analogies; give context for culture-specific references instead of keeping them opaque.
- Keep terminology consistent, sentences coherent and logical, and the meaning of every concept faithful to its original purpose.`;

const PSYCHOLOGY = `- Audience: psychologists, therapists, students and interested general readers. Balance accessibility with academic accuracy.
- Prefer clarity over literal translation; use concise sentences and a professional tone without stiff structures.
- Use the established target-language term for each psychological concept and keep it consistent.
- For concepts without an established equivalent, translate literally and add the original term in parentheses on first use, e.g. "<translated term> (gaslighting)".
- Preserve headings and titles without commentary; keep citations, references and study names intact.
- Make the flow natural and smooth in the target language; never add content of your own.`;

export const GUIDELINE_PRESETS: GuidelinePreset[] = [
  { id: 'general', label: 'General', guideline: GENERAL },
  { id: 'fiction', label: 'Fiction', guideline: FICTION },
  { id: 'technical', label: 'Technical / IT', guideline: TECHNICAL },
  { id: 'psychology', label: 'Psychology', guideline: PSYCHOLOGY },
];

export function getGuidelinePreset(id: GuidelinePresetId): GuidelinePreset {
  const preset = GUIDELINE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown guideline preset: ${id}`);
  return preset;
}
