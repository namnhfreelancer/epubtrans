/**
 * Characters that may not appear in an XML 1.0 document: C0 controls except tab, line feed and carriage return,
 * lone surrogates (a JavaScript string can hold them, UTF-8 cannot), and the noncharacters U+FFFE and U+FFFF.
 * Model output (translations, glosses) and crafted project files can contain them; one such character makes the
 * exported XHTML not well-formed, which reading systems reject as a whole file.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the control characters XML forbids is the point.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `text` without the characters XML 1.0 forbids (see {@link XML_INVALID}); everything else is kept as it is. */
export function stripXmlInvalidChars(text: string): string {
  return text.replace(XML_INVALID, '');
}
