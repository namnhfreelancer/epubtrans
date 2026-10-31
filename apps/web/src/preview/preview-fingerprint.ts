import type { ExportMode, Project } from '@epubtrans/core';

/** cyrb53: fast 53-bit string hash (not cryptographic), folded over several strings. */
function hashStrings(parts: Iterable<string>): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const ch = part.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    // Separator, so ["ab", "c"] and ["a", "bc"] differ.
    h1 = Math.imul(h1 ^ 0x1f, 2654435761);
    h2 = Math.imul(h2 ^ 0x1f, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Everything an export can depend on besides the immutable source book: the mode, the project's own fields (settings
 * and whatever per-book options are added later) and each segment's state. Equal fingerprints mean an identical
 * preview, so a project "change" that altered none of it skips the rebuild.
 */
export function previewFingerprint(project: Project, mode: ExportMode): string {
  function* parts(): Generator<string> {
    const { chapters: _chapters, sourceEpub: _source, updatedAt: _updated, ...fields } = project;
    yield mode;
    yield JSON.stringify(fields);
    for (const chapter of project.chapters) {
      for (const s of chapter.segments) {
        yield s.id;
        yield s.status;
        yield s.translationHtml ?? '';
      }
    }
  }
  return hashStrings(parts());
}
