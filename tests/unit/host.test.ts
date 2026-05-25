import { describe, expect, test } from 'bun:test';
import { type HostInfo, compareUrl, detectHost } from '../../src/core/host.js';

describe('detectHost', () => {
  test('detects github.com', () => {
    expect(detectHost(['[1.0.0]: https://github.com/foo/bar/releases/tag/v1.0.0'])).toEqual({
      kind: 'github',
      base: 'https://github.com/foo/bar',
    });
  });

  test('detects gitlab.com', () => {
    expect(detectHost(['[1.0.0]: https://gitlab.com/foo/bar/-/tags/v1.0.0'])).toEqual({
      kind: 'gitlab',
      base: 'https://gitlab.com/foo/bar',
    });
  });

  test('detects self-hosted gitlab', () => {
    expect(detectHost(['https://gitlab.acme.internal/foo/bar/-/tags'])).toEqual({
      kind: 'gitlab',
      base: 'https://gitlab.acme.internal/foo/bar',
    });
  });

  test('detects bitbucket.org', () => {
    expect(detectHost(['https://bitbucket.org/foo/bar/branches/'])).toEqual({
      kind: 'bitbucket',
      base: 'https://bitbucket.org/foo/bar',
    });
  });

  test('strips trailing .git from repo segment', () => {
    expect(detectHost(['https://github.com/foo/bar.git'])).toEqual({
      kind: 'github',
      base: 'https://github.com/foo/bar',
    });
  });

  test('skips non-forge URLs', () => {
    expect(detectHost(['https://example.com/some/page'])).toBeNull();
  });

  test('falls through to generic when host contains "git"', () => {
    expect(detectHost(['https://git.acme.internal/foo/bar'])).toEqual({
      kind: 'generic',
      base: 'https://git.acme.internal/foo/bar',
    });
  });

  test('returns null on empty input', () => {
    expect(detectHost([])).toBeNull();
  });
});

describe('compareUrl', () => {
  const gh: HostInfo = { kind: 'github', base: 'https://github.com/foo/bar' };
  const gl: HostInfo = { kind: 'gitlab', base: 'https://gitlab.com/foo/bar' };
  const bb: HostInfo = { kind: 'bitbucket', base: 'https://bitbucket.org/foo/bar' };
  const gen: HostInfo = { kind: 'generic', base: 'https://git.acme.internal/foo/bar' };

  test('github uses /compare/from...to', () => {
    expect(compareUrl(gh, 'v1.0.0', 'v1.1.0')).toBe(
      'https://github.com/foo/bar/compare/v1.0.0...v1.1.0',
    );
  });

  test('gitlab uses /-/compare/from...to', () => {
    expect(compareUrl(gl, 'v1.0.0', 'v1.1.0')).toBe(
      'https://gitlab.com/foo/bar/-/compare/v1.0.0...v1.1.0',
    );
  });

  test('bitbucket reverses order and uses two dots', () => {
    expect(compareUrl(bb, 'v1.0.0', 'v1.1.0')).toBe(
      'https://bitbucket.org/foo/bar/branches/compare/v1.1.0..v1.0.0',
    );
  });

  test('generic falls back to /compare/from...to', () => {
    expect(compareUrl(gen, 'v1.0.0', 'v1.1.0')).toBe(
      'https://git.acme.internal/foo/bar/compare/v1.0.0...v1.1.0',
    );
  });
});
