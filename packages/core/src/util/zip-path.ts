/** POSIX-style path helpers for paths inside a zip container (no leading slash). */

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Resolves `href` (URL-encoded, may contain a fragment) relative to the directory `baseDir`. */
export function resolvePath(baseDir: string, href: string): string {
  const clean = safeDecode(href.split('#')[0] ?? '');
  const parts = (clean.startsWith('/') ? clean.slice(1) : baseDir ? `${baseDir}/${clean}` : clean).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/** Relative href from the file `fromPath` to the file `toPath`, URL-encoded per segment. */
export function relativeHref(fromPath: string, toPath: string): string {
  const from = dirname(fromPath).split('/').filter(Boolean);
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => '..');
  return [...up, ...to.slice(i)].map((p) => (p === '..' ? p : encodeURIComponent(p))).join('/');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
