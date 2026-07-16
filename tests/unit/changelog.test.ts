import { describe, expect, test } from 'bun:test';
import { parse, release, serialize } from '../../src/core/changelog.js';
import { PubvError } from '../../src/core/errors.js';
import { listFixtures, loadFixture } from '../helpers/fixture.js';

describe('changelog fixtures', () => {
  for (const name of listFixtures()) {
    test(name, () => {
      const f = loadFixture(name);
      const parsed = parse(f.input);

      if (f.meta.expectError) {
        expect(() => release(parsed, f.meta)).toThrow(PubvError);
        try {
          release(parsed, f.meta);
        } catch (err) {
          expect(err).toBeInstanceOf(PubvError);
          expect((err as PubvError).code).toBe(f.meta.expectError);
        }
        return;
      }

      const out = serialize(release(parsed, f.meta));
      expect(out).toBe(f.expected!);
    });
  }
});

describe('parse', () => {
  test('detects LF and CRLF line endings', () => {
    expect(parse('# t\n\n## [Unreleased]\n').eol).toBe('\n');
    expect(parse('# t\r\n\r\n## [Unreleased]\r\n').eol).toBe('\r\n');
  });

  test('treats lowercase `unreleased` heading as Unreleased', () => {
    const cl = parse('## [unreleased]\n\n- foo\n');
    expect(cl.unreleased).not.toBeNull();
    expect(cl.unreleased!.version).toBe('Unreleased');
  });

  test('captures dates and versions accurately', () => {
    const cl = parse('## [1.2.3] - 2025-01-02\n');
    expect(cl.releases).toHaveLength(1);
    expect(cl.releases[0]!.version).toBe('1.2.3');
    expect(cl.releases[0]!.date).toBe('2025-01-02');
  });

  test('survives a file with no link refs', () => {
    const cl = parse('# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2025-01-01\n');
    expect(cl.links).toEqual([]);
    expect(cl.releases).toHaveLength(1);
    expect(cl.warnings).toEqual([]);
  });

  test('recovers link refs hidden behind a stray trailing line', () => {
    const cl = parse(
      '## [Unreleased]\n\n- x\n\n[Unreleased]: https://e.com/c/1.0.0...HEAD\n[1.0.0]: https://e.com/c/0.0.0...1.0.0\n˚\n',
    );
    // The `˚` must not defeat extraction: both refs are still captured, not
    // absorbed into the section body.
    expect(cl.links).toEqual([
      { name: 'Unreleased', url: 'https://e.com/c/1.0.0...HEAD' },
      { name: '1.0.0', url: 'https://e.com/c/0.0.0...1.0.0' },
    ]);
    expect(cl.unreleased!.body).toEqual(['- x']);
    expect(cl.warnings).toEqual(['ignored 1 stray line below the link-reference section: "˚"']);
  });

  test('collapses duplicate link definitions in the source', () => {
    const cl = parse(
      '## [Unreleased]\n\n[Unreleased]: https://e.com/a\n[Unreleased]: https://e.com/b\n',
    );
    expect(cl.links).toEqual([{ name: 'Unreleased', url: 'https://e.com/a' }]);
    expect(cl.warnings).toEqual(['collapsed duplicate link definition [Unreleased]']);
  });

  test('leaves a link-shaped line inside a section body untouched', () => {
    // No trailing link block, so nothing should be pulled out of the body.
    const cl = parse(
      '## [Unreleased]\n\n[note]: see the migration guide\n\n## [1.0.0] - 2025-01-01\n\n- y\n',
    );
    expect(cl.links).toEqual([]);
    expect(cl.warnings).toEqual([]);
    expect(cl.unreleased!.body).toEqual(['[note]: see the migration guide']);
  });
});

describe('release', () => {
  test('throws PubvError(no-unreleased) when [Unreleased] is missing', () => {
    const cl = parse('## [1.0.0] - 2025-01-01\n');
    expect(() =>
      release(cl, {
        version: '1.1.0',
        date: '2025-02-01',
        unreleasedUrl: 'u',
        versionUrl: 'v',
      }),
    ).toThrow(PubvError);
  });

  test('collapses a stale version link def and carries parse warnings forward', () => {
    // Mirrors the real-world corruption: a first release whose source already
    // carried a `[1.0.0]` def plus a stray line trailing the link block.
    const cl = parse(
      '## [Unreleased]\n\n- x\n\n[Unreleased]: https://e.com/c/1.0.0...HEAD\n[1.0.0]: https://e.com/c/0.0.0...1.0.0\n˚\n',
    );
    const next = release(cl, {
      version: '1.0.0',
      date: '2026-07-16',
      unreleasedUrl: 'https://e.com/-/c/1.0.0...main',
      versionUrl: 'https://e.com/-/c/0.0.0...1.0.0',
    });
    // Exactly one def per name — no duplicate `[1.0.0]`.
    expect(next.links).toEqual([
      { name: 'Unreleased', url: 'https://e.com/-/c/1.0.0...main' },
      { name: '1.0.0', url: 'https://e.com/-/c/0.0.0...1.0.0' },
    ]);
    expect(next.warnings).toEqual([
      'ignored 1 stray line below the link-reference section: "˚"',
      'collapsed duplicate link definition [1.0.0]',
    ]);
  });

  test('moves unreleased body into the new versioned section', () => {
    const cl = parse('## [Unreleased]\n\n### Added\n\n- foo\n');
    const next = release(cl, {
      version: '0.1.0',
      date: '2025-01-01',
      unreleasedUrl: 'u',
      versionUrl: 'v',
    });
    expect(next.unreleased!.body).toEqual([]);
    expect(next.releases[0]!.version).toBe('0.1.0');
    expect(next.releases[0]!.body).toEqual(['### Added', '', '- foo']);
  });
});

describe('serialize round-trip', () => {
  test('parse + serialize is idempotent for well-formed input', () => {
    const src =
      '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a\n\n## [1.0.0] - 2025-01-01\n\n### Added\n\n- b\n\n[Unreleased]: https://example.com/compare/v1.0.0...HEAD\n[1.0.0]: https://example.com/releases/v1.0.0\n';
    expect(serialize(parse(src))).toBe(src);
  });
});
