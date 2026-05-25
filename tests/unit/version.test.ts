import { describe, expect, test } from 'bun:test';
import {
  bump,
  formatSemver,
  isValidVersionString,
  parseSemver,
  suggestDefault,
} from '../../src/core/version.js';

describe('parseSemver', () => {
  test.each([
    ['1.2.3', { major: 1, minor: 2, patch: 3, prerelease: null }],
    ['v1.2.3', { major: 1, minor: 2, patch: 3, prerelease: null }],
    ['0.0.0', { major: 0, minor: 0, patch: 0, prerelease: null }],
    ['1.0.0-rc.1', { major: 1, minor: 0, patch: 0, prerelease: 'rc.1' }],
    ['v2.5.4-beta', { major: 2, minor: 5, patch: 4, prerelease: 'beta' }],
  ])('parses %s', (input, expected) => {
    expect(parseSemver(input)).toEqual(expected);
  });

  test.each(['1.2', '1.2.3.4', 'foo', '1.2.3-', '', 'v1', '1.2.3+meta'])('rejects %s', (input) => {
    expect(parseSemver(input)).toBeNull();
  });
});

describe('formatSemver', () => {
  test('round-trips with parseSemver', () => {
    for (const s of ['1.2.3', '0.0.1', '10.20.30', '1.0.0-rc.1', '2.0.0-beta.5']) {
      expect(formatSemver(parseSemver(s)!)).toBe(s);
    }
  });
});

describe('isValidVersionString', () => {
  test('accepts canonical and v-prefixed', () => {
    expect(isValidVersionString('1.2.3')).toBe(true);
    expect(isValidVersionString('v1.2.3-rc.1')).toBe(true);
  });
  test('rejects garbage', () => {
    expect(isValidVersionString('not-a-version')).toBe(false);
  });
});

describe('bump', () => {
  const base = parseSemver('1.2.3')!;

  test('major', () => expect(formatSemver(bump(base, 'major'))).toBe('2.0.0'));
  test('minor', () => expect(formatSemver(bump(base, 'minor'))).toBe('1.3.0'));
  test('patch', () => expect(formatSemver(bump(base, 'patch'))).toBe('1.2.4'));

  test('major resets minor, patch, and prerelease', () => {
    const v = parseSemver('1.2.3-rc.1')!;
    expect(formatSemver(bump(v, 'major'))).toBe('2.0.0');
  });

  test('prerelease increments trailing numeric identifier', () => {
    const v = parseSemver('1.0.0-rc.1')!;
    expect(formatSemver(bump(v, 'prerelease'))).toBe('1.0.0-rc.2');
  });

  test('prerelease appends `.1` when there is no numeric tail', () => {
    const v = parseSemver('1.0.0-beta')!;
    expect(formatSemver(bump(v, 'prerelease'))).toBe('1.0.0-beta.1');
  });

  test('prerelease bump from a stable version starts at rc.1', () => {
    const v = parseSemver('1.0.0')!;
    expect(formatSemver(bump(v, 'prerelease'))).toBe('1.0.0-rc.1');
  });
});

describe('suggestDefault', () => {
  test.each([
    ['### Changed\n- **BC**: drop Node 18', 'major'],
    ['### Removed\n- legacyHandler', 'patch'],
    ['Conventional: BREAKING CHANGE: rename API', 'major'],
    ['### Breaking changes\n- something', 'major'],
    ['### Added\n- new thing', 'minor'],
    ['### Changed\n- behavior tweak', 'minor'],
    ['### Fixed\n- crash bug', 'patch'],
    ['### Security\n- bumped dep past CVE', 'patch'],
    ['', 'patch'],
  ] as const)('classifies %j as %s', (body, expected) => {
    expect(suggestDefault(body)).toBe(expected);
  });

  test('lowercase "breaking" inside prose does NOT trigger major', () => {
    expect(suggestDefault('### Fixed\n- the breaking bug from #42')).not.toBe('major');
  });

  test('"BC" word-boundary matches, but "BCD" does not', () => {
    expect(suggestDefault('BC: removed legacy')).toBe('major');
    expect(suggestDefault('Added BCD field to payload')).toBe('minor');
  });
});
