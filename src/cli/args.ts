import { PubvError } from '../core/errors.js';
import type { TagPrefix } from '../core/tag-prefix.js';

export interface ParsedArgs {
  version: string | null;
  changelogPath: string;
  remote: string;
  /** Force a specific `YYYY-MM-DD` heading date (defaults to today). */
  date: string | null;
  tagPrefix: TagPrefix | null;
  yes: boolean;
  dryRun: boolean;
  push: boolean;
  tag: boolean;
  /** Sign the release commit and tag (`git commit -S` / `git tag -s`). */
  sign: boolean;
  /** Create a forge release (via `gh` / `glab`) after pushing the tag. */
  release: boolean;
  /** Allow graduating an empty `[Unreleased]` section. */
  allowEmpty: boolean;
  /** Open a release branch + merge request instead of pushing the default branch. */
  mergeRequest: boolean;
  /** Tag the latest changelog release on HEAD and push the tag (post-merge step). */
  tagRelease: boolean;
  /** Scaffold a new changelog and exit (the `init` command). */
  init: boolean;
  help: boolean;
  showVersion: boolean;
}

export function defaultArgs(): ParsedArgs {
  return {
    version: null,
    changelogPath: 'CHANGELOG.md',
    remote: 'origin',
    date: null,
    tagPrefix: null,
    yes: false,
    dryRun: false,
    push: true,
    tag: true,
    sign: false,
    release: false,
    allowEmpty: false,
    mergeRequest: false,
    tagRelease: false,
    init: false,
    help: false,
    showVersion: false,
  };
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out = defaultArgs();
  let positional: string | null = null;
  let endOfFlags = false;

  for (const arg of argv) {
    if (endOfFlags) {
      positional = setPositional(positional, arg);
      continue;
    }
    if (arg === '--') {
      endOfFlags = true;
      continue;
    }
    if (handleBool(arg, out)) continue;
    if (handleValue(arg, out)) continue;
    if (arg.startsWith('-')) {
      throw new PubvError('invalid-flag', `unknown flag: ${arg}`);
    }
    positional = setPositional(positional, arg);
  }
  if (positional === 'init') {
    out.init = true;
  } else {
    out.version = positional;
  }
  validate(out);
  return out;
}

function validate(out: ParsedArgs): void {
  if (out.mergeRequest && out.tagRelease) {
    throw new PubvError('invalid-flag', '--merge-request and --tag-release are mutually exclusive');
  }
  if (out.mergeRequest && !out.push) {
    throw new PubvError('invalid-flag', '--merge-request pushes a branch; remove --no-push');
  }
  if (out.init && (out.mergeRequest || out.tagRelease)) {
    throw new PubvError(
      'invalid-flag',
      'init cannot be combined with --merge-request/--tag-release',
    );
  }
  if (out.release && !out.tag) {
    throw new PubvError('invalid-flag', '--release needs a tag; remove --no-tag');
  }
  if (out.release && !out.push) {
    throw new PubvError('invalid-flag', '--release needs a pushed tag; remove --no-push');
  }
  if (out.release && out.mergeRequest) {
    throw new PubvError(
      'invalid-flag',
      '--release has no tag in merge-request mode; pass --release on the --tag-release step',
    );
  }
}

function handleBool(arg: string, out: ParsedArgs): boolean {
  switch (arg) {
    case '-h':
    case '--help':
      out.help = true;
      return true;
    case '-v':
    case '--version':
      out.showVersion = true;
      return true;
    case '-y':
    case '--yes':
      out.yes = true;
      return true;
    case '--dry-run':
      out.dryRun = true;
      return true;
    case '--no-push':
      out.push = false;
      return true;
    case '--no-tag':
      out.tag = false;
      return true;
    case '--sign':
      out.sign = true;
      return true;
    case '--release':
      out.release = true;
      return true;
    case '--allow-empty':
      out.allowEmpty = true;
      return true;
    case '--merge-request':
    case '--mr':
      out.mergeRequest = true;
      return true;
    case '--tag-release':
    case '--tag-only':
      out.tagRelease = true;
      return true;
  }
  return false;
}

function handleValue(arg: string, out: ParsedArgs): boolean {
  const equals = arg.indexOf('=');
  if (equals === -1 || !arg.startsWith('--')) return false;
  const key = arg.slice(0, equals);
  const value = arg.slice(equals + 1);

  switch (key) {
    case '--tag-prefix':
      if (value === 'none' || value === '') out.tagPrefix = '';
      else if (/\s/.test(value)) {
        throw new PubvError(
          'invalid-flag',
          `--tag-prefix must not contain whitespace, got '${value}'`,
        );
      } else out.tagPrefix = value;
      return true;
    case '--changelog':
      if (!value) throw new PubvError('invalid-flag', '--changelog requires a path');
      out.changelogPath = value;
      return true;
    case '--remote':
      if (!value) throw new PubvError('invalid-flag', '--remote requires a name');
      out.remote = value;
      return true;
    case '--date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new PubvError('invalid-flag', `--date must be YYYY-MM-DD, got '${value}'`);
      }
      out.date = value;
      return true;
  }
  return false;
}

function setPositional(current: string | null, value: string): string {
  if (current !== null) {
    throw new PubvError('invalid-flag', `unexpected extra argument: ${value}`);
  }
  return value;
}
