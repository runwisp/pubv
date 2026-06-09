import type { HostKind } from '../core/host.js';

/**
 * Best-effort classification of an arbitrary host (a custom domain whose name
 * gives no hint) by probing it over HTTP. Used to recognise self-hosted forges
 * — primarily GitLab — that the cheap host-name heuristics can't identify.
 *
 * Implementations must never throw: when the kind can't be determined (host
 * unreachable, login-walled, timed out, not a known forge) they return `null`
 * so the caller can fall back to a `generic` classification.
 */
export interface HostProber {
  /** `hostname` is the bare authority (`code.acme.com`, optionally `host:port`). */
  classify(hostname: string): Promise<HostKind | null>;
}
