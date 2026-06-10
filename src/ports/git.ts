export interface BranchStatus {
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

export interface PushOptions {
  followTags: boolean;
  /** Pass `-u` to set the upstream tracking branch (for a brand-new branch). */
  setUpstream?: boolean;
}

/** GPG-signing toggle shared by commit and tag operations. */
export interface SignOptions {
  /** Sign the object (`git commit -S` / `git tag -s`). */
  sign?: boolean;
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
  /** URL of the named remote (`git remote get-url`), or `null` if it has none. */
  remoteUrl(remote: string): Promise<string | null>;
  /** True when there are no uncommitted changes (staged or unstaged). */
  isClean(): Promise<boolean>;
  fetch(remote: string): Promise<void>;
  branchStatus(branch: string, remote: string): Promise<BranchStatus>;
  /** All local tag names, in repository order. */
  listTags(): Promise<string[]>;
  /** The very first commit (root) hash. Used when there is no prior version. */
  firstCommit(): Promise<string>;
  stage(path: string): Promise<void>;
  commit(message: string, options?: SignOptions): Promise<void>;
  tag(name: string, message: string, options?: SignOptions): Promise<void>;
  push(remote: string, branch: string, options: PushOptions): Promise<void>;
  /** Create and switch to a new branch off the current HEAD. */
  createBranch(name: string): Promise<void>;
  /** Switch to an existing branch. */
  switchBranch(name: string): Promise<void>;
  /** Push a single tag to the remote. */
  pushTag(remote: string, tag: string): Promise<void>;
}
