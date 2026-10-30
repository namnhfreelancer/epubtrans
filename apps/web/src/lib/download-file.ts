/** Saves bytes as a file through a temporary object URL. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start reading the blob asynchronously after the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** File-system safe name derived from a book title. */
export function safeFileName(title: string, fallback = 'book'): string {
  const printable = Array.from(title, (ch) => ((ch.codePointAt(0) ?? 0) < 0x20 ? ' ' : ch)).join('');
  const name = printable
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return name || fallback;
}
