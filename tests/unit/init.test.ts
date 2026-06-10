import { describe, expect, test } from 'bun:test';
import { buildScaffold, normalizeRepoUrl } from '../../src/core/init.js';

describe('buildScaffold', () => {
  const CANONICAL = [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
    'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).',
    '',
    '## [Unreleased]',
  ];

  test('emits the full canonical Keep a Changelog header', () => {
    const out = buildScaffold({ repoUrl: null });
    expect(out).toBe(`${CANONICAL.join('\n')}\n`);
  });

  test('seeds an [Unreleased] link ref from the repo URL', () => {
    const out = buildScaffold({ repoUrl: 'git@github.com:owner/repo.git' });
    expect(out).toBe(
      `${[...CANONICAL, '', '[Unreleased]: https://github.com/owner/repo'].join('\n')}\n`,
    );
  });

  test('ends with a single trailing newline', () => {
    expect(buildScaffold({ repoUrl: null }).endsWith('\n')).toBe(true);
    expect(buildScaffold({ repoUrl: null }).endsWith('\n\n')).toBe(false);
  });
});

describe('normalizeRepoUrl', () => {
  test('scp-style git remote', () => {
    expect(normalizeRepoUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  test('https remote with .git suffix', () => {
    expect(normalizeRepoUrl('https://gitlab.com/group/proj.git')).toBe(
      'https://gitlab.com/group/proj',
    );
  });

  test('https remote without suffix is left intact', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });
});
