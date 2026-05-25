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
  out.version = positional;
  return out;
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
      if (value === 'v') out.tagPrefix = 'v';
      else if (value === 'none' || value === '') out.tagPrefix = '';
      else
        throw new PubvError('invalid-flag', `--tag-prefix must be 'v' or 'none', got '${value}'`);
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
