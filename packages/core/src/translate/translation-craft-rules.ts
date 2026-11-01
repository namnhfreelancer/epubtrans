/**
 * Fixed target-language craft rules of the translate and polish prompts. They are part of the system prompt, not
 * of the editable guideline, so a user who replaces the guideline cannot drop them. Vietnamese gets concrete rules
 * against the common English→Vietnamese calques; other targets get a short generic anti-translationese section.
 */

export const isVietnameseTarget = (targetLang: string): boolean => /^vi(?:[-_]|$)/i.test(targetLang.trim());

const VIETNAMESE_CRAFT = `## Writing natural Vietnamese (avoid translationese)
- Prefer active voice or a topic–comment sentence. Use "bị" only for something adverse and "được" only for something beneficial, never for every passive of the source.
- Do not render adverbs as "một cách + adjective" when a fitting adverb, verb or reduplicative word exists. Avoid chains of "của", "sự/việc" nominalizations and noun stacks in source word order; turn them into verbs and clauses.
- Do not repeat "anh ấy/cô ấy/họ" in every clause: drop the subject when it is clear, or vary it with a name, title or kinship term. Never call a person "nó" unless the narrator is deliberately intimate or contemptuous.
- Keep register and xưng hô consistent across the book: choose forms of address from the relationship, age and situation (or as the style guideline fixes them) and never switch them between segments.
- Translate idioms and figures of speech by meaning; use a Vietnamese idiom (thành ngữ) only when its tone fits, otherwise say it plainly.
- Balance Sino-Vietnamese and native words for the register; avoid stiff officialese and slang the author would not use.
- Use “…” for quotations unless the style guideline sets another convention.
- Example. Literal: "Cô ấy đã được thông báo bởi bác sĩ rằng cô ấy cần phải nghỉ ngơi một cách đầy đủ." Natural: "Bác sĩ dặn cô phải nghỉ ngơi cho thật đủ."`;

const genericCraft = (target: string) => `## Writing natural ${target} (avoid translationese)
- Follow ${target} word order, sentence length and punctuation conventions, not the source's: split long sentences and merge choppy ones when a native writer would.
- Avoid calques of source syntax: passive voice, nominalizations, possessive chains and pronouns where ${target} would phrase it differently.
- Translate idioms and figures of speech by meaning, with a natural ${target} equivalent when one exists.
- Keep register and forms of address consistent across the book.`;

/** The craft section for a target language; `target` is its English name (e.g. "French"). */
export function craftSection(targetLang: string, target: string): string {
  return isVietnameseTarget(targetLang) ? VIETNAMESE_CRAFT : genericCraft(target);
}
