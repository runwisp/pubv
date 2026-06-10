import { describe, expect, test } from 'bun:test';
import {
  type HostInfo,
  type RemoteRef,
  compareUrl,
  detectHost,
  mergeRequestUrl,
  parseRemoteUrl,
} from '../../src/core/host.js';

describe('detectHost', () => {
  const cases: Array<{ name: string; lines: string[]; expected: HostInfo | null }> = [
    {
      name: 'detects github.com',
      lines: ['[1.0.0]: https://github.com/foo/bar/releases/tag/v1.0.0'],
      expected: { kind: 'github', base: 'https://github.com/foo/bar' },
    },
    {
      name: 'detects gitlab.com',
      lines: ['[1.0.0]: https://gitlab.com/foo/bar/-/tags/v1.0.0'],
      expected: { kind: 'gitlab', base: 'https://gitlab.com/foo/bar' },
    },
    {
      name: 'detects self-hosted gitlab',
      lines: ['https://gitlab.acme.internal/foo/bar/-/tags'],
      expected: { kind: 'gitlab', base: 'https://gitlab.acme.internal/foo/bar' },
    },
    {
      // The host name says nothing about GitLab; the `/-/` separator is the tell.
      name: 'detects self-hosted gitlab on a custom domain via the /-/ route marker',
      lines: ['[1.0.0]: https://code.acme.com/team/app/-/tags/v1.0.0'],
      expected: { kind: 'gitlab', base: 'https://code.acme.com/team/app' },
    },
    {
      name: 'recovers the full project path for a gitlab subgroup',
      lines: ['https://devops.example.org/group/sub/project/-/merge_requests/7'],
      expected: { kind: 'gitlab', base: 'https://devops.example.org/group/sub/project' },
    },
    {
      name: 'detects self-hosted gitlab from a compare link with no "gitlab" in the host',
      lines: ['[Unreleased]: https://vcs.corp.io/team/app/-/compare/v1.0.0...main'],
      expected: { kind: 'gitlab', base: 'https://vcs.corp.io/team/app' },
    },
    {
      name: 'preserves a non-standard port',
      lines: ['https://git.acme.com:8443/team/app/-/tags/v1.0.0'],
      expected: { kind: 'gitlab', base: 'https://git.acme.com:8443/team/app' },
    },
    {
      name: 'does not mistake a github resource path for the /-/ marker',
      lines: ['https://github.com/foo/bar/releases/tag/v1.0.0'],
      expected: { kind: 'github', base: 'https://github.com/foo/bar' },
    },
    {
      name: 'detects bitbucket.org',
      lines: ['https://bitbucket.org/foo/bar/branches/'],
      expected: { kind: 'bitbucket', base: 'https://bitbucket.org/foo/bar' },
    },
    {
      name: 'strips trailing .git from repo segment',
      lines: ['https://github.com/foo/bar.git'],
      expected: { kind: 'github', base: 'https://github.com/foo/bar' },
    },
    {
      name: 'skips non-forge URLs',
      lines: ['https://example.com/some/page'],
      expected: null,
    },
    {
      name: 'falls through to generic when host contains "git"',
      lines: ['https://git.acme.internal/foo/bar'],
      expected: { kind: 'generic', base: 'https://git.acme.internal/foo/bar' },
    },
    {
      name: 'returns null on empty input',
      lines: [],
      expected: null,
    },
  ];

  test.each(cases)('$name', ({ lines, expected }) => {
    expect(detectHost(lines)).toEqual(expected);
  });
});

describe('parseRemoteUrl', () => {
  const cases: Array<{ name: string; remote: string; expected: RemoteRef | null }> = [
    {
      name: 'https remote → host + project path, .git stripped',
      remote: 'https://github.com/foo/bar.git',
      expected: { host: 'github.com', projectPath: 'foo/bar' },
    },
    {
      name: 'https remote keeps a non-standard port',
      remote: 'https://code.acme.com:8443/team/app.git',
      expected: { host: 'code.acme.com:8443', projectPath: 'team/app' },
    },
    {
      name: 'https remote drops the default port',
      remote: 'https://code.acme.com:443/team/app',
      expected: { host: 'code.acme.com', projectPath: 'team/app' },
    },
    {
      name: 'ssh:// remote drops the ssh port (web UI is on 443)',
      remote: 'ssh://git@code.acme.com:2222/group/sub/proj.git',
      expected: { host: 'code.acme.com', projectPath: 'group/sub/proj' },
    },
    {
      name: 'scp-style remote with a subgroup keeps the full path',
      remote: 'git@code.acme.com:group/sub/proj.git',
      expected: { host: 'code.acme.com', projectPath: 'group/sub/proj' },
    },
    {
      name: 'file:// → null',
      remote: 'file:///srv/git/repo.git',
      expected: null,
    },
    {
      name: 'bare local path → null',
      remote: '/home/user/x/remote.git',
      expected: null,
    },
    {
      name: 'relative path → null',
      remote: '../relative/repo',
      expected: null,
    },
    {
      name: 'whitespace-only remote → null',
      remote: '   ',
      expected: null,
    },
    {
      name: 'URL with a host but no project path → null',
      remote: 'https://github.com/',
      expected: null,
    },
  ];

  test.each(cases)('$name', ({ remote, expected }) => {
    expect(parseRemoteUrl(remote)).toEqual(expected);
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

describe('mergeRequestUrl', () => {
  const gh: HostInfo = { kind: 'github', base: 'https://github.com/foo/bar' };
  const gl: HostInfo = { kind: 'gitlab', base: 'https://gitlab.com/foo/bar' };
  const bb: HostInfo = { kind: 'bitbucket', base: 'https://bitbucket.org/foo/bar' };
  const gen: HostInfo = { kind: 'generic', base: 'https://git.acme.internal/foo/bar' };

  test('github opens a compare PR with the branch encoded', () => {
    expect(mergeRequestUrl(gh, 'release/v1.1.0', 'main')).toBe(
      'https://github.com/foo/bar/compare/main...release%2Fv1.1.0?expand=1',
    );
  });

  test('gitlab opens the new merge request form with source/target prefilled', () => {
    expect(mergeRequestUrl(gl, 'release/v1.1.0', 'main')).toBe(
      'https://gitlab.com/foo/bar/-/merge_requests/new?merge_request%5Bsource_branch%5D=release%2Fv1.1.0&merge_request%5Btarget_branch%5D=main',
    );
  });

  test('bitbucket opens the new pull request form', () => {
    expect(mergeRequestUrl(bb, 'release/v1.1.0', 'main')).toBe(
      'https://bitbucket.org/foo/bar/pull-requests/new?source=release%2Fv1.1.0&dest=main&t=1',
    );
  });

  test('generic falls back to the github-style compare form', () => {
    expect(mergeRequestUrl(gen, 'release/v1.1.0', 'main')).toBe(
      'https://git.acme.internal/foo/bar/compare/main...release%2Fv1.1.0?expand=1',
    );
  });
});
