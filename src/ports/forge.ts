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
 * Create a release page on the forge by shelling out to its CLI (`gh` / `glab`).
 * Implementations must never throw: a missing CLI, an unsupported host, or a
 * failed invocation all resolve to `{ created: false, reason }` so the caller
 * can carry on — the tag is already pushed by the time this runs.
 */
export interface Forge {
  createRelease(req: ReleaseRequest): Promise<ReleaseResult>;
}
