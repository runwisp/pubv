/** Literal text prepended to the semver core of a tag, e.g. `'v'`, `''`, `'myapp.'`. */
export type TagPrefix = string;

/**
 * Detection outcome:
 * - `{ kind: 'unique', prefix }` — all semver-shaped tags agree on one prefix.
 * - `{ kind: 'ambiguous' }` — more than one distinct prefix; caller should prompt.
 * - `{ kind: 'none' }` — no semver-shaped tags found; caller picks a default.
 */
export type TagPrefixDetection =
  | { kind: 'unique'; prefix: TagPrefix }
  | { kind: 'ambiguous' }
  | { kind: 'none' };

// Non-greedy head + end-anchored semver: the shortest prefix that leaves a
// valid `x.y.z[-tag]` wins, so `v1.2.3` → (`v`,`1.2.3`), `myapp.1.2.3` →
// (`myapp.`,`1.2.3`), `app2.1.2.3` → (`app2.`,`1.2.3`), bare → (``,`1.2.3`).
const TAG_RE = /^(.*?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Split a tag/version string into its prefix and bare semver, or `null`. */
export function splitPrefix(input: string): { prefix: TagPrefix; version: string } | null {
  const m = TAG_RE.exec(input);
  if (!m) return null;
  return { prefix: m[1]!, version: m[2]! };
}

export function detectPrefix(tags: readonly string[]): TagPrefixDetection {
  const prefixes = new Set<string>();
  for (const tag of tags) {
    const m = TAG_RE.exec(tag);
    if (m) prefixes.add(m[1]!);
  }
  if (prefixes.size === 0) return { kind: 'none' };
  if (prefixes.size === 1) return { kind: 'unique', prefix: [...prefixes][0]! };
  return { kind: 'ambiguous' };
}

export function applyPrefix(version: string, prefix: TagPrefix): string {
  return `${prefix}${version}`;
}
