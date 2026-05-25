export type TagPrefix = '' | 'v';

/**
 * Detection outcome:
 * - `'v'` / `''` — all existing semver-shaped tags agree on a prefix.
 * - `'ambiguous'` — mix of prefixed and bare tags; caller should prompt.
 * - `'none'` — no semver-shaped tags found; caller picks a default.
 */
export type TagPrefixDetection = TagPrefix | 'ambiguous' | 'none';

const TAG_RE = /^(v?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function detectPrefix(tags: readonly string[]): TagPrefixDetection {
  let prefixed = 0;
  let bare = 0;
  for (const tag of tags) {
    const m = TAG_RE.exec(tag);
    if (!m) continue;
    if (m[1] === 'v') prefixed++;
    else bare++;
  }
  if (prefixed === 0 && bare === 0) return 'none';
  if (prefixed > 0 && bare === 0) return 'v';
  if (prefixed === 0 && bare > 0) return '';
  return 'ambiguous';
}

export function applyPrefix(version: string, prefix: TagPrefix): string {
  return `${prefix}${version}`;
}
