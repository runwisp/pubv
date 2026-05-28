export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release tail without the leading `-`, e.g. `rc.1`; `null` for stable releases. */
  prerelease: string | null;
}

export type BumpKind = 'major' | 'minor' | 'patch' | 'prerelease';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(input: string): SemVer | null {
  const stripped = input.startsWith('v') ? input.slice(1) : input;
  const m = SEMVER_RE.exec(stripped);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

export function formatSemver(v: SemVer): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease ? `${base}-${v.prerelease}` : base;
}

export function isValidVersionString(input: string): boolean {
  return parseSemver(input) !== null;
}

export function bump(v: SemVer, kind: BumpKind): SemVer {
  switch (kind) {
    case 'major':
      return { major: v.major + 1, minor: 0, patch: 0, prerelease: null };
    case 'minor':
      return { major: v.major, minor: v.minor + 1, patch: 0, prerelease: null };
    case 'patch':
      return { major: v.major, minor: v.minor, patch: v.patch + 1, prerelease: null };
    case 'prerelease':
      return { ...v, prerelease: bumpPrerelease(v.prerelease) };
  }
}

function bumpPrerelease(pre: string | null): string {
  if (!pre) return 'rc.1';
  const parts = pre.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i]!)) {
      parts[i] = String(Number(parts[i]) + 1);
      return parts.join('.');
    }
  }
  return [...parts, '1'].join('.');
}

/**
 * Pick the default bump kind based on the [Unreleased] body text.
 *
 * - "BC", "BREAKING CHANGE", or capital-B "Breaking" anywhere → major.
 * - "Added" or "Changed" → minor (matches the original script).
 * - Otherwise → patch.
 *
 * Note: "Removed" alone is NOT a major signal — many changelogs use it for
 * deprecations, dead-code removal, etc. that aren't breaking.
 */
export function suggestDefault(unreleasedBody: string): Exclude<BumpKind, 'prerelease'> {
  if (/\bBC\b|\bBREAKING\s+CHANGE\b|\bBreaking\b/.test(unreleasedBody)) return 'major';
  if (/\b(Added|Changed)\b/i.test(unreleasedBody)) return 'minor';
  return 'patch';
}
