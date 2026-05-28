import { describe, expect, test } from 'bun:test';
import { applyPrefix, detectPrefix } from '../../src/core/tag-prefix.js';

describe('detectPrefix', () => {
  test('returns "none" for an empty list', () => {
    expect(detectPrefix([])).toBe('none');
  });

  test('returns "none" when no tags look semver-shaped', () => {
    expect(detectPrefix(['main', 'release/foo'])).toBe('none');
  });

  test('returns "v" when all matching tags carry the prefix', () => {
    expect(detectPrefix(['v1.0.0', 'v1.1.0', 'v2.0.0-rc.1', 'random-tag'])).toBe('v');
  });

  test('returns "" when all matching tags are bare', () => {
    expect(detectPrefix(['1.0.0', '1.1.0', '0.9.0-rc.1'])).toBe('');
  });

  test('returns "ambiguous" on mixed tags', () => {
    expect(detectPrefix(['v1.0.0', '1.1.0'])).toBe('ambiguous');
  });

  test('ignores non-semver tags entirely', () => {
    expect(detectPrefix(['legacy', 'v1.0.0', 'beta-release'])).toBe('v');
  });
});

describe('applyPrefix', () => {
  test('prepends the prefix when present', () => {
    expect(applyPrefix('1.2.3', 'v')).toBe('v1.2.3');
  });

  test('passes through when prefix is empty', () => {
    expect(applyPrefix('1.2.3', '')).toBe('1.2.3');
  });
});
