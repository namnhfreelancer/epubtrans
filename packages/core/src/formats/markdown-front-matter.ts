/**
 * YAML front matter of a Markdown book: only `title`, `author` and `lang`/`language` are read, from simple `key: value`
 * lines. Nothing else of YAML is needed to build the book's metadata.
 */

export interface FrontMatter {
  title?: string;
  author?: string;
  lang?: string;
}

const FRONT_MATTER_MAX_LINES = 60;
const YAML_KEY = /^[A-Za-z_][\w-]*[ \t]*:(?:[ \t]|$)/;
const YAML_ITEM_OR_CONTINUATION = /^(?:[ \t]*-(?:[ \t]|$)|[ \t]+\S|[ \t]*#)/;

const isBlank = (line: string) => line.trim() === '';

/** A YAML scalar as text: quotes removed and their escapes resolved, a trailing comment of a plain value dropped. */
function yamlScalar(raw: string): string {
  const value = raw.trim();
  let text: string;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    text = value.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, esc: string) => {
      if (esc.length > 1) {
        const code = Number.parseInt(esc.slice(1), 16);
        return code < 0x20 ? ' ' : String.fromCharCode(code);
      }
      return esc === 'n' || esc === 't' || esc === 'r' ? ' ' : esc;
    });
  } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) text = value.slice(1, -1).replace(/''/g, "'");
  else text = value.replace(/[ \t]+#.*$/, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** True when every non-blank line looks like YAML: `key: value` lines, with list items or indented lines under a key. */
function looksLikeYaml(lines: string[]): boolean {
  let keys = 0;
  for (const line of lines) {
    if (isBlank(line)) continue;
    if (YAML_KEY.test(line)) keys++;
    else if (keys === 0 || !YAML_ITEM_OR_CONTINUATION.test(line)) return false;
  }
  return keys > 0;
}

/**
 * Strips a leading `---` YAML block and reads `title`, `author` and `lang`/`language` from it. A `---` block that is not
 * YAML (fiction uses `---` as a scene break) is left in the text, where it reads as a thematic break.
 */
export function splitFrontMatter(lines: string[]): { meta: FrontMatter; body: string[] } {
  const none = { meta: {}, body: lines };
  if (lines[0]?.trim() !== '---' || isBlank(lines[1] ?? '')) return none;
  let end = -1;
  for (let i = 1; i < lines.length && i <= FRONT_MATTER_MAX_LINES; i++) {
    if (/^(?:---|\.\.\.)\s*$/.test(lines[i] as string)) {
      end = i;
      break;
    }
  }
  if (end < 0 || !looksLikeYaml(lines.slice(1, end))) return none;
  const meta: FrontMatter = {};
  for (const line of lines.slice(1, end)) {
    const m = /^(title|author|lang|language)[ \t]*:[ \t]*(.+)$/i.exec(line);
    if (!m) continue;
    const value = yamlScalar(m[2] as string);
    const key = (m[1] as string).toLowerCase();
    if (!value) continue;
    if (key === 'title') meta.title = value;
    else if (key === 'author') meta.author = value;
    else meta.lang = value;
  }
  return { meta, body: lines.slice(end + 1) };
}
