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

/**
 * Mixed prefixes are resolved by the tag of `lastVersion` (the previous
 * release): if exactly one prefix carries it, that is the scheme in use now.
 */
export function detectPrefix(
  tags: readonly string[],
  lastVersion: string | null = null,
): TagPrefixDetection {
  const prefixes = new Set<string>();
  const lastPrefixes = new Set<string>();
  const last = lastVersion === null ? null : splitPrefix(lastVersion)?.version;
  for (const tag of tags) {
    const m = TAG_RE.exec(tag);
    if (!m) continue;
    prefixes.add(m[1]!);
    if (m[2] === last) lastPrefixes.add(m[1]!);
  }
  if (prefixes.size === 0) return { kind: 'none' };
  if (prefixes.size === 1) return { kind: 'unique', prefix: [...prefixes][0]! };
  if (lastPrefixes.size === 1) return { kind: 'unique', prefix: [...lastPrefixes][0]! };
  return { kind: 'ambiguous' };
}

export function applyPrefix(version: string, prefix: TagPrefix): string {
  return `${prefix}${version}`;
}
