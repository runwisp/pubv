import type { HostInfo } from '../core/host.js';

/**
 * Read-only query against the forge (GitHub / GitLab) to learn whether a branch
 * is protected — used to decide between a direct push and a merge request before
 * any local commit/tag is made. Implementations must be best-effort and never
 * throw: when protection can't be determined (no CLI, unsupported host, network
 * or auth failure) they return `null` so the caller can fall back to pushing.
 */
export interface Forge {
  /** `true` = protected, `false` = not protected, `null` = undeterminable. */
  branchProtected(host: HostInfo, branch: string): Promise<boolean | null>;
}
