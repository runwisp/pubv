import { describe, expect, test } from 'bun:test';
import { applyPrefix, detectPrefix, splitPrefix } from '../../src/core/tag-prefix.js';

describe('detectPrefix', () => {
  test('returns "none" for an empty list', () => {
    expect(detectPrefix([])).toEqual({ kind: 'none' });
  });

  test('returns "none" when no tags look semver-shaped', () => {
    expect(detectPrefix(['main', 'release/foo'])).toEqual({ kind: 'none' });
  });

  test('detects the "v" prefix when all matching tags carry it', () => {
    expect(detectPrefix(['v1.0.0', 'v1.1.0', 'v2.0.0-rc.1', 'random-tag'])).toEqual({
      kind: 'unique',
      prefix: 'v',
    });
  });

  test('detects the bare prefix when all matching tags are bare', () => {
    expect(detectPrefix(['1.0.0', '1.1.0', '0.9.0-rc.1'])).toEqual({ kind: 'unique', prefix: '' });
  });

  test('detects an arbitrary custom prefix', () => {
    expect(detectPrefix(['myapp.1.2.3', 'myapp.1.3.0', 'myapp.2.0.0-RC5'])).toEqual({
      kind: 'unique',
      prefix: 'myapp.',
    });
  });

  test('detects a prefix that itself ends in digits', () => {
    expect(detectPrefix(['app2.1.2.3', 'app2.1.3.0'])).toEqual({ kind: 'unique', prefix: 'app2.' });
  });

  test('returns "ambiguous" on a mix of v and bare', () => {
    expect(detectPrefix(['v1.0.0', '1.1.0'])).toEqual({ kind: 'ambiguous' });
  });

  test('returns "ambiguous" across distinct custom prefixes', () => {
    expect(detectPrefix(['myapp.1.0.0', 'lib.1.0.0'])).toEqual({ kind: 'ambiguous' });
  });

  test('ignores non-semver tags entirely', () => {
    expect(detectPrefix(['legacy', 'v1.0.0', 'beta-release'])).toEqual({
      kind: 'unique',
      prefix: 'v',
    });
  });
});

describe('splitPrefix', () => {
  test.each([
    ['1.2.3', { prefix: '', version: '1.2.3' }],
    ['v1.2.3', { prefix: 'v', version: '1.2.3' }],
    ['v1.2.3-rc.1', { prefix: 'v', version: '1.2.3-rc.1' }],
    ['myapp.1.2.3', { prefix: 'myapp.', version: '1.2.3' }],
    ['myapp-1.2.3', { prefix: 'myapp-', version: '1.2.3' }],
    ['myapp.1.0.0-RC5', { prefix: 'myapp.', version: '1.0.0-RC5' }],
    ['app2.1.2.3', { prefix: 'app2.', version: '1.2.3' }],
  ])('splits %s', (input, expected) => {
    expect(splitPrefix(input)).toEqual(expected);
  });

  test.each(['1.2', 'not-a-version', 'myapp.', ''])('returns null for %j', (input) => {
    expect(splitPrefix(input)).toBeNull();
  });
});

describe('applyPrefix', () => {
  test('prepends the prefix when present', () => {
    expect(applyPrefix('1.2.3', 'v')).toBe('v1.2.3');
    expect(applyPrefix('1.2.3', 'myapp.')).toBe('myapp.1.2.3');
  });

  test('passes through when prefix is empty', () => {
    expect(applyPrefix('1.2.3', '')).toBe('1.2.3');
  });
});
