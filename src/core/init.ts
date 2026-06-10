export interface ScaffoldOptions {
  /** Forge project URL used to seed the `[Unreleased]` link ref; `null` to omit it. */
  repoUrl: string | null;
}

const HEADER = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).',
  '',
  '## [Unreleased]',
];

/**
 * Build a fresh Keep a Changelog 1.1.0 file with an empty `[Unreleased]`
 * section. When a forge URL is known it is seeded as the `[Unreleased]` link
 * ref so the very first `pubv` run can detect the host without manual edits.
 */
export function buildScaffold(opts: ScaffoldOptions): string {
  const lines = [...HEADER];
  const base = opts.repoUrl ? normalizeRepoUrl(opts.repoUrl) : null;
  if (base) {
    lines.push('', `[Unreleased]: ${base}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Normalize a git remote URL to an `https://host/owner/repo` project URL.
 * Handles `git@host:owner/repo.git` and `https://host/owner/repo.git`, and
 * returns the trimmed input unchanged when it matches neither.
 */
export function normalizeRepoUrl(raw: string): string {
  const url = raw.trim();
  const scp = /^[^@]+@([^:]+):(.+?)(?:\.git)?\/?$/.exec(url);
  if (scp) return `https://${scp[1]}/${stripGit(scp[2]!)}`;
  const https = /^https?:\/\/(?:[^@]+@)?(.+?)(?:\.git)?\/?$/.exec(url);
  if (https) return `https://${stripGit(https[1]!)}`;
  return url;
}

function stripGit(path: string): string {
  return path.endsWith('.git') ? path.slice(0, -4) : path;
}
