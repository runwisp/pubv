export type HostKind = 'github' | 'gitlab' | 'bitbucket' | 'generic';

export interface HostInfo {
  kind: HostKind;
  /** Project base URL with no trailing slash, e.g. `https://github.com/owner/repo`. */
  base: string;
}

export interface RemoteRef {
  /** Web authority — hostname plus any non-standard *web* port (e.g. `code.acme.com:8443`). */
  host: string;
  /** Full project path, subgroups included, no leading/trailing slash, no `.git`. */
  projectPath: string;
}

// A whole http(s) URL token, up to whitespace or a closing markdown/quote
// delimiter — enough to parse with `new URL` and inspect the full path.
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/;

/**
 * Find the first URL in the given lines that looks like a forge project URL
 * (github / gitlab / bitbucket / generic git-host). Returns the host kind and
 * the project base URL, or `null` when nothing matches.
 */
export function detectHost(lines: readonly string[]): HostInfo | null {
  for (const line of lines) {
    const info = detectInLine(line);
    if (info) return info;
  }
  return null;
}

function detectInLine(line: string): HostInfo | null {
  const m = URL_RE.exec(line);
  if (!m) return null;

  let url: URL;
  try {
    url = new URL(m[0]);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  // GitLab routes a project's resources behind a `/-/` separator
  // (`/group/sub/proj/-/tags`, `/-/compare`, `/-/merge_requests`). No other
  // forge uses it, and it's independent of the host name — so it reliably
  // identifies *self-hosted* GitLab on a custom domain, and everything before
  // it is the project path (subgroups included). This is the strongest signal,
  // so it's checked before host-name classification.
  const dashIndex = segments.indexOf('-');
  if (dashIndex >= 2) {
    const projectPath = segments.slice(0, dashIndex).join('/');
    return { kind: 'gitlab', base: `https://${url.host}/${projectPath}` };
  }

  // No `/-/` marker: fall back to recognising the host by name. A bare project
  // URL (`https://gitlab.example.com/owner/repo`) still classifies correctly
  // when the host name itself names the forge.
  const owner = segments[0]!;
  const repo = stripTrailingGit(segments[1]!);
  const kind = classifyHost(url.hostname);
  if (kind === 'generic' && !/git/i.test(url.hostname)) return null;
  return { kind, base: `https://${url.host}/${owner}/${repo}` };
}

/**
 * Cheap, network-free classification of a forge by host *name* alone. Returns
 * `generic` for custom domains that give no hint — the caller can then probe
 * the host over HTTP to recognise a self-hosted forge. The `host` may carry a
 * port (`gitlab.example.com:8443`); substring matching is unaffected.
 */
export function classifyHost(host: string): HostKind {
  const h = host.toLowerCase();
  if (h === 'github.com' || h.endsWith('.github.com')) return 'github';
  if (h.includes('gitlab')) return 'gitlab';
  if (h.includes('bitbucket')) return 'bitbucket';
  return 'generic';
}

/**
 * Parse a git remote URL into its web authority + project path — the
 * authoritative source for which forge a repo lives on. Handles `https`/`http`
 * (custom port preserved), `ssh://` and scp-style `git@host:path` (the ssh port
 * is dropped — the web UI is on 443), and strips a trailing `.git`. Returns
 * `null` for `file://`, bare local/relative paths, and hostless URLs.
 */
export function parseRemoteUrl(remote: string): RemoteRef | null {
  const raw = remote.trim();
  if (!raw) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    switch (url.protocol) {
      case 'https:':
      case 'http:':
        // `url.host` keeps a non-standard port; default ports are dropped.
        return buildRemoteRef(url.host, url.pathname);
      case 'ssh:':
      case 'git:':
        // Git transport ports don't apply to the web UI — use the bare host.
        return buildRemoteRef(url.hostname, url.pathname);
      default:
        return null; // file://, etc.
    }
  }

  // scp-style `[user@]host:group/sub/proj.git` (no scheme, no leading slash).
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(raw);
  if (scp) return buildRemoteRef(scp[1]!, scp[2]!);

  return null; // local path, relative path, hostless
}

function buildRemoteRef(host: string, rawPath: string): RemoteRef | null {
  if (!host) return null;
  const segments = rawPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  segments[segments.length - 1] = stripTrailingGit(segments[segments.length - 1]!);
  return { host, projectPath: segments.join('/') };
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

/**
 * Build a "create merge/pull request" URL for the host, opening `source` into
 * `target` with fields prefilled where the forge supports it.
 */
export function mergeRequestUrl(host: HostInfo, source: string, target: string): string {
  const s = encodeURIComponent(source);
  const t = encodeURIComponent(target);
  switch (host.kind) {
    case 'github':
    case 'generic':
      return `${host.base}/compare/${t}...${s}?expand=1`;
    case 'gitlab':
      return `${host.base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${s}&merge_request%5Btarget_branch%5D=${t}`;
    case 'bitbucket':
      return `${host.base}/pull-requests/new?source=${s}&dest=${t}&t=1`;
  }
}
