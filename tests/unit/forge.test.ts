import { describe, expect, test } from 'bun:test';
import { forgeQuery } from '../../src/adapters/forge-cli.js';
import type { HostInfo } from '../../src/core/host.js';

const host = (kind: HostInfo['kind'], base: string): HostInfo => ({ kind, base });

describe('forgeQuery', () => {
  test('github.com → gh api with no --hostname', () => {
    const q = forgeQuery(host('github', 'https://github.com/acme/widget'), 'main');
    expect(q).toEqual({
      cmd: 'gh',
      args: ['api', 'repos/acme/widget/branches/main', '--jq', '.protected'],
    });
  });

  test('GitHub Enterprise host adds --hostname', () => {
    const q = forgeQuery(host('github', 'https://git.enterprise.github.com/acme/widget'), 'main');
    expect(q?.cmd).toBe('gh');
    expect(q?.args).toEqual([
      'api',
      'repos/acme/widget/branches/main',
      '--jq',
      '.protected',
      '--hostname',
      'git.enterprise.github.com',
    ]);
  });

  test('gitlab → glab api with URL-encoded project + GITLAB_HOST', () => {
    const q = forgeQuery(host('gitlab', 'https://gitlab.com/acme/widget'), 'main');
    expect(q).toEqual({
      cmd: 'glab',
      args: ['api', 'projects/acme%2Fwidget/repository/branches/main', '--jq', '.protected'],
      env: { GITLAB_HOST: 'gitlab.com' },
    });
  });

  test('self-hosted gitlab targets its own host', () => {
    const q = forgeQuery(host('gitlab', 'https://gitlab.acme.internal/team/app'), 'release');
    expect(q?.env).toEqual({ GITLAB_HOST: 'gitlab.acme.internal' });
    expect(q?.args).toEqual([
      'api',
      'projects/team%2Fapp/repository/branches/release',
      '--jq',
      '.protected',
    ]);
  });

  test('branch names with slashes are encoded', () => {
    const q = forgeQuery(host('gitlab', 'https://gitlab.com/acme/widget'), 'release/1.0');
    expect(q?.args[1]).toBe('projects/acme%2Fwidget/repository/branches/release%2F1.0');
  });

  test('bitbucket and generic hosts are unsupported', () => {
    expect(forgeQuery(host('bitbucket', 'https://bitbucket.org/acme/widget'), 'main')).toBeNull();
    expect(forgeQuery(host('generic', 'https://git.acme.com/acme/widget'), 'main')).toBeNull();
  });
});
