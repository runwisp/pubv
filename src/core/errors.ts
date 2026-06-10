export type PubvErrorCode =
  | 'no-changelog'
  | 'no-unreleased'
  | 'no-release'
  | 'empty-release'
  | 'changelog-exists'
  | 'tag-exists'
  | 'no-host'
  | 'invalid-version'
  | 'invalid-flag'
  | 'dirty-tree'
  | 'wrong-branch'
  | 'behind-remote'
  | 'user-aborted'
  | 'git-failure';

export class PubvError extends Error {
  readonly code: PubvErrorCode;
  readonly exitCode: number;

  constructor(code: PubvErrorCode, message: string, exitCode = 1) {
    super(message);
    this.name = 'PubvError';
    this.code = code;
    this.exitCode = exitCode;
  }
}
