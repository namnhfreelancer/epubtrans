/** Prefix the retranslate action adds around a core error; the UI adds its own label, so it is dropped to avoid saying it twice. */
const RETRANSLATE_PREFIX = /^\s*(?:retranslation failed\s*:\s*)+/i;

/** The failure reason of a segment without wrapper prefixes, or undefined when nothing meaningful is left. */
export function segmentErrorText(message: string | undefined): string | undefined {
  const text = message?.replace(RETRANSLATE_PREFIX, '').trim();
  return text ? text : undefined;
}
