export interface BranchStatus {
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

export interface PushOptions {
  followTags: boolean;
}

/**
 * Minimal git surface used by the release orchestrator. Each method maps to
 * a single git invocation; the adapter is free to shell out, use a library,
 * or be a stub in tests.
 */
export interface Git {
  /** Best-effort default branch via `origin/HEAD`; falls back to `main`. */
  defaultBranch(): Promise<string>;
  currentBranch(): Promise<string>;
  /** True when there are no uncommitted changes (staged or unstaged). */
  isClean(): Promise<boolean>;
  fetch(remote: string): Promise<void>;
  branchStatus(branch: string, remote: string): Promise<BranchStatus>;
  /** All local tag names, in repository order. */
  listTags(): Promise<string[]>;
  /** The very first commit (root) hash. Used when there is no prior version. */
  firstCommit(): Promise<string>;
  stage(path: string): Promise<void>;
  commit(message: string): Promise<void>;
  tag(name: string, message: string): Promise<void>;
  push(remote: string, branch: string, options: PushOptions): Promise<void>;
}
