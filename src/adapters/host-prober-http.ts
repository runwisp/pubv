import type { HostKind } from '../core/host.js';
import type { HostProber } from '../ports/host-prober.js';

export interface HttpHostProberOptions {
  /** Abort the request after this many ms (default 2000). */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Value sent as `User-Agent` (default `pubv`). */
  userAgent?: string;
}

/**
 * Recognise a self-hosted GitLab on a custom domain by fetching its PWA manifest
 * (`GET /-/manifest.json`) — JSON whose `name`/`short_name` is `GitLab`. The
 * manifest is served before login, so it works on reachable instances without
 * auth. Best-effort and non-blocking: the request is timeout-bounded and any
 * failure (unreachable, login-walled, timed out, not GitLab) yields `null`, so
 * the caller keeps a `generic` classification and never blocks a release.
 */
export function createHttpHostProber(opts: HttpHostProberOptions = {}): HostProber {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const userAgent = opts.userAgent ?? 'pubv';

  return {
    async classify(hostname: string): Promise<HostKind | null> {
      if (!hostname) return null;
      try {
        const res = await doFetch(`https://${hostname}/-/manifest.json`, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': userAgent },
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { name?: unknown; short_name?: unknown };
        if (json.short_name === 'GitLab' || json.name === 'GitLab') return 'gitlab';
        return null;
      } catch {
        // Unreachable, timed out, redirected to a login page, not JSON — all
        // mean "can't tell", so the caller falls back to a generic host.
        return null;
      }
    },
  };
}
