import type { HostInfo } from '../core/host.js';

export interface ReleaseRequest {
  host: HostInfo;
  /** The tag the release points at (already pushed). */
  tag: string;
  /** Human-facing release title. */
  title: string;
  /** Release notes body (the graduated changelog entries). */
  notes: string;
}

export interface ReleaseResult {
  /** True when a release was actually created on the forge. */
  created: boolean;
  /** The created release's URL, when the CLI reports one. */
  url?: string;
  /** Why creation was skipped or failed (CLI missing, unsupported host, error). */
  reason?: string;
}

/**
 * Talks to the forge (GitHub / GitLab) by shelling out to its CLI (`gh` / `glab`).
 * Implementations must be best-effort and never throw:
 *
 * - `branchProtected` returns `null` when protection can't be determined (no CLI,
 *   unsupported host, network or auth failure) so the caller can fall back to pushing.
 * - `createRelease` resolves to `{ created: false, reason }` when a release can't be
 *   made (CLI missing, unsupported host, error) so the caller can carry on — the tag
 *   is already pushed by the time this runs.
 */
export interface Forge {
  /** `true` = protected, `false` = not protected, `null` = undeterminable. */
  branchProtected(host: HostInfo, branch: string): Promise<boolean | null>;
  createRelease(req: ReleaseRequest): Promise<ReleaseResult>;
}
