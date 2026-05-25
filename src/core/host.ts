export type HostKind = 'github' | 'gitlab' | 'bitbucket' | 'generic';

export interface HostInfo {
  kind: HostKind;
  /** Project base URL with no trailing slash, e.g. `https://github.com/owner/repo`. */
  base: string;
}

const URL_RE = /https?:\/\/([^\s/]+)\/([^\s/]+)\/([^\s/?#]+)/;

/**
 * Find the first URL in the given lines that looks like a forge project URL
 * (github / gitlab / bitbucket / generic git-host). Returns the host kind and
 * the project base URL, or `null` when nothing matches.
 */
export function detectHost(lines: readonly string[]): HostInfo | null {
  for (const line of lines) {
    const m = URL_RE.exec(line);
    if (!m) continue;
    const host = m[1]!;
    const owner = m[2]!;
    const repo = stripTrailingGit(m[3]!);
    const kind = classifyHost(host);
    if (kind === 'generic' && !/git/i.test(host)) continue;
    return { kind, base: `https://${host}/${owner}/${repo}` };
  }
  return null;
}

function classifyHost(host: string): HostKind {
  const h = host.toLowerCase();
  if (h === 'github.com' || h.endsWith('.github.com')) return 'github';
  if (h.includes('gitlab')) return 'gitlab';
  if (h.includes('bitbucket')) return 'bitbucket';
  return 'generic';
}

function stripTrailingGit(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

/**
 * Build a compare-URL appropriate for the host (`from`...`to` or `from`..`to`,
 * with or without GitLab's `/-/` segment).
 */
export function compareUrl(host: HostInfo, from: string, to: string): string {
  switch (host.kind) {
    case 'github':
    case 'generic':
      return `${host.base}/compare/${from}...${to}`;
    case 'gitlab':
      return `${host.base}/-/compare/${from}...${to}`;
    case 'bitbucket':
      return `${host.base}/branches/compare/${to}..${from}`;
  }
}
