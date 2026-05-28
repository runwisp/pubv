import { describe, expect, test } from 'bun:test';
import { defaultArgs, parseArgs } from '../../src/cli/args.js';
import { PubvError } from '../../src/core/errors.js';

describe('parseArgs', () => {
  test('returns defaults for empty input', () => {
    expect(parseArgs([])).toEqual(defaultArgs());
  });

  test('parses positional version', () => {
    expect(parseArgs(['1.2.3'])).toMatchObject({ version: '1.2.3' });
    expect(parseArgs(['minor'])).toMatchObject({ version: 'minor' });
  });

  test('parses long and short bool flags', () => {
    expect(parseArgs(['--yes'])).toMatchObject({ yes: true });
    expect(parseArgs(['-y'])).toMatchObject({ yes: true });
    expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true });
    expect(parseArgs(['--no-push'])).toMatchObject({ push: false });
    expect(parseArgs(['--no-tag'])).toMatchObject({ tag: false });
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
    expect(parseArgs(['-h'])).toMatchObject({ help: true });
    expect(parseArgs(['--version'])).toMatchObject({ showVersion: true });
    expect(parseArgs(['-v'])).toMatchObject({ showVersion: true });
  });

  test('parses --key=value flags', () => {
    expect(parseArgs(['--tag-prefix=v'])).toMatchObject({ tagPrefix: 'v' });
    expect(parseArgs(['--tag-prefix=none'])).toMatchObject({ tagPrefix: '' });
    expect(parseArgs(['--changelog=docs/CHANGELOG.md'])).toMatchObject({
      changelogPath: 'docs/CHANGELOG.md',
    });
    expect(parseArgs(['--remote=upstream'])).toMatchObject({ remote: 'upstream' });
  });

  test('combines flags and positional', () => {
    expect(parseArgs(['--yes', '--dry-run', '1.2.3'])).toMatchObject({
      yes: true,
      dryRun: true,
      version: '1.2.3',
    });
  });

  test('parses merge-request and tag-release flags with aliases', () => {
    expect(parseArgs(['--merge-request'])).toMatchObject({ mergeRequest: true });
    expect(parseArgs(['--mr'])).toMatchObject({ mergeRequest: true });
    expect(parseArgs(['--tag-release'])).toMatchObject({ tagRelease: true });
    expect(parseArgs(['--tag-only'])).toMatchObject({ tagRelease: true });
  });

  test('rejects --merge-request together with --tag-release', () => {
    expect(() => parseArgs(['--merge-request', '--tag-release'])).toThrow(PubvError);
  });

  test('rejects --merge-request together with --no-push', () => {
    expect(() => parseArgs(['--merge-request', '--no-push'])).toThrow(PubvError);
  });

  test('rejects unknown flag', () => {
    expect(() => parseArgs(['--what'])).toThrow(PubvError);
  });

  test('rejects invalid --tag-prefix value', () => {
    expect(() => parseArgs(['--tag-prefix=wat'])).toThrow(PubvError);
  });

  test('rejects extra positional', () => {
    expect(() => parseArgs(['1.2.3', '4.5.6'])).toThrow(PubvError);
  });

  test('-- ends flag parsing', () => {
    expect(parseArgs(['--', '--what'])).toMatchObject({ version: '--what' });
  });
});
