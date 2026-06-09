import { describe, expect, test } from 'bun:test';
import {
  type HostInfo,
  compareUrl,
  detectHost,
  mergeRequestUrl,
  parseRemoteUrl,
} from '../../src/core/host.js';

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

  test('detects self-hosted gitlab on a custom domain via the /-/ route marker', () => {
    // The host name says nothing about GitLab; the `/-/` separator is the tell.
    expect(detectHost(['[1.0.0]: https://code.acme.com/team/app/-/tags/v1.0.0'])).toEqual({
      kind: 'gitlab',
      base: 'https://code.acme.com/team/app',
    });
  });

  test('recovers the full project path for a gitlab subgroup', () => {
    expect(detectHost(['https://devops.example.org/group/sub/project/-/merge_requests/7'])).toEqual(
      {
        kind: 'gitlab',
        base: 'https://devops.example.org/group/sub/project',
      },
    );
  });

  test('detects self-hosted gitlab from a compare link with no "gitlab" in the host', () => {
    expect(
      detectHost(['[Unreleased]: https://vcs.corp.io/team/app/-/compare/v1.0.0...main']),
    ).toEqual({
      kind: 'gitlab',
      base: 'https://vcs.corp.io/team/app',
    });
  });

  test('preserves a non-standard port', () => {
    expect(detectHost(['https://git.acme.com:8443/team/app/-/tags/v1.0.0'])).toEqual({
      kind: 'gitlab',
      base: 'https://git.acme.com:8443/team/app',
    });
  });

  test('does not mistake a github resource path for the /-/ marker', () => {
    expect(detectHost(['https://github.com/foo/bar/releases/tag/v1.0.0'])).toEqual({
      kind: 'github',
      base: 'https://github.com/foo/bar',
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

describe('parseRemoteUrl', () => {
  test('https remote → host + project path, .git stripped', () => {
    expect(parseRemoteUrl('https://github.com/foo/bar.git')).toEqual({
      host: 'github.com',
      projectPath: 'foo/bar',
    });
  });

  test('https remote keeps a non-standard port', () => {
    expect(parseRemoteUrl('https://code.acme.com:8443/team/app.git')).toEqual({
      host: 'code.acme.com:8443',
      projectPath: 'team/app',
    });
  });

  test('https remote drops the default port', () => {
    expect(parseRemoteUrl('https://code.acme.com:443/team/app')).toEqual({
      host: 'code.acme.com',
      projectPath: 'team/app',
    });
  });

  test('ssh:// remote drops the ssh port (web UI is on 443)', () => {
    expect(parseRemoteUrl('ssh://git@code.acme.com:2222/group/sub/proj.git')).toEqual({
      host: 'code.acme.com',
      projectPath: 'group/sub/proj',
    });
  });

  test('scp-style remote with a subgroup keeps the full path', () => {
    expect(parseRemoteUrl('git@code.acme.com:group/sub/proj.git')).toEqual({
      host: 'code.acme.com',
      projectPath: 'group/sub/proj',
    });
  });

  test('file:// → null', () => {
    expect(parseRemoteUrl('file:///srv/git/repo.git')).toBeNull();
  });

  test('bare local path → null', () => {
    expect(parseRemoteUrl('/tmp/x/remote.git')).toBeNull();
  });

  test('relative path and empty string → null', () => {
    expect(parseRemoteUrl('../relative/repo')).toBeNull();
    expect(parseRemoteUrl('   ')).toBeNull();
  });

  test('URL with a host but no project path → null', () => {
    expect(parseRemoteUrl('https://github.com/')).toBeNull();
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
