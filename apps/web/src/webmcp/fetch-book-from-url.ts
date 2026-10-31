import { MAX_FILE_BYTES } from '../lib/import-book-file';
import type { ToolContext } from './tool-context';
import { clip, fail, type ToolFailure } from './tool-result';

const DROP_HINT = 'Ask the user to download the file and drop it on the library page, then call list_books.';
const MAX_URL_LENGTH = 2048;

/** Parses an agent-supplied book URL: https only (no http, so local services cannot be probed) and no credentials. */
export function parseBookUrl(input: string): URL | ToolFailure {
  if (input.length > MAX_URL_LENGTH) return fail(`The URL is longer than ${MAX_URL_LENGTH} characters.`);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail('The URL is not valid.', 'Pass an absolute https:// URL of an EPUB, MOBI, AZW3, FB2 or .epubtrans file.');
  }
  if (url.protocol !== 'https:') return fail('Only https:// URLs can be imported.', DROP_HINT);
  if (url.username || url.password) return fail('URLs with a user name or password are not accepted.');
  return url;
}

/** File name for the downloaded book: the last path segment (its extension tells project files apart), else "book". */
function fileNameOf(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Keep the raw segment when it is not valid percent-encoding.
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not allowed in file names.
  name = name.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, ' ').trim();
  return clip(name, 120) || 'book';
}

/** Reads the body, refusing anything over the import size cap (Content-Length first, then a streamed byte count). */
async function readCapped(response: Response): Promise<Uint8Array | ToolFailure> {
  const tooLarge = () => fail(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB, the most the browser can import.`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) return tooLarge();
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > MAX_FILE_BYTES ? tooLarge() : bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloads a book from an approved https URL as a File, without cookies or referrer. Fails with a clear message when
 * the host does not allow cross-origin downloads (CORS), answers an error, redirects off https, or the file is too big.
 */
export async function fetchBookFromUrl(ctx: ToolContext, url: URL, signal: AbortSignal | undefined): Promise<File | ToolFailure> {
  let response: Response;
  try {
    response = await ctx.fetch(url.href, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) return fail('The download was cancelled.');
    // The browser deliberately hides the exact reason (CORS, DNS, offline) from the page.
    return fail(`The host ${url.host} does not allow downloads from web pages (no CORS headers), or it could not be reached.`, DROP_HINT);
  }
  if (response.url && new URL(response.url).protocol !== 'https:') return fail('The download was redirected away from https.', DROP_HINT);
  if (!response.ok) return fail(`The host answered HTTP ${response.status}.`, 'Check the URL, or ask the user to drop the file on the library page.');
  let bytes: Uint8Array | ToolFailure;
  try {
    bytes = await readCapped(response);
  } catch {
    return fail(signal?.aborted ? 'The download was cancelled.' : 'The download was interrupted.', DROP_HINT);
  }
  if (!(bytes instanceof Uint8Array)) return bytes;
  return new File([bytes as Uint8Array<ArrayBuffer>], fileNameOf(url));
}
