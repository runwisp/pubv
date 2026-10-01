/**
 * Detection outcome:
 * - `{ kind: 'unique', prefix }` — all semver-shaped tags agree on one prefix.
 * - `{ kind: 'ambiguous' }` — more than one distinct prefix; caller should prompt.
 * - `{ kind: 'none' }` — no semver-shaped tags found; caller picks a default.
 */
export type TagPrefixDetection =
  | { kind: 'unique'; prefix: string }
  | { kind: 'ambiguous' }
  | { kind: 'none' };

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Split a tag/version string into its prefix and bare semver, or `null`. The
 * shortest prefix (literal text, e.g. `'v'`, `''`, `'myapp.'`) that leaves a
 * valid `x.y.z[-tag]` wins, so `v1.2.3` → (`v`,`1.2.3`), `myapp.1.2.3` →
 * (`myapp.`,`1.2.3`), `app2.1.2.3` → (`app2.`,`1.2.3`), bare → (``,`1.2.3`).
 */
export function splitPrefix(input: string): { prefix: string; version: string } | null {
  for (let i = 0; i < input.length; i++) {
    const version = input.slice(i);
    if (SEMVER_RE.test(version)) return { prefix: input.slice(0, i), version };
  }
  return null;
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
    const split = splitPrefix(tag);
    if (!split) continue;
    prefixes.add(split.prefix);
    if (split.version === last) lastPrefixes.add(split.prefix);
  }
  if (prefixes.size === 0) return { kind: 'none' };
  if (prefixes.size === 1) return { kind: 'unique', prefix: [...prefixes][0]! };
  if (lastPrefixes.size === 1) return { kind: 'unique', prefix: [...lastPrefixes][0]! };
  return { kind: 'ambiguous' };
}

export function applyPrefix(version: string, prefix: string): string {
  return `${prefix}${version}`;
}
