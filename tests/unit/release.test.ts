import { beforeEach, describe, expect, test } from 'bun:test';
import { PubvError } from '../../src/core/errors.js';
import { type Ports, type ReleaseInputs, run } from '../../src/core/release.js';
import { FakeFs, FakeGit, FakePrompt, SilentLogger } from '../helpers/fakes.js';
import { loadFixture } from '../helpers/fixture.js';

function defaultInputs(overrides: Partial<ReleaseInputs> = {}): ReleaseInputs {
  return {
    changelogPath: 'CHANGELOG.md',
    versionArg: null,
    tagPrefixOverride: null,
    yes: true,
    dryRun: false,
    push: true,
    tag: true,
    today: '2026-05-25',
    remote: 'origin',
    ...overrides,
  };
}

function makePorts(): Ports & { fs: FakeFs; git: FakeGit; prompt: FakePrompt; log: SilentLogger } {
  return {
    fs: new FakeFs(),
    git: new FakeGit(),
    prompt: new FakePrompt(),
    log: new SilentLogger(),
  };
}

describe('run() — happy paths', () => {
  let ports: ReturnType<typeof makePorts>;
  beforeEach(() => {
    ports = makePorts();
  });

  test('graduates a minor release end-to-end with --yes', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.0.0', 'v1.1.0', 'v1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0' }), ports);

    expect(plan.nextVersion).toBe('1.3.0');
    expect(plan.tagName).toBe('v1.3.0');
    expect(plan.commitMessage).toBe('v1.3.0');
    expect(ports.fs.files.get('CHANGELOG.md')).toBe(fixture.expected!);
    expect(ports.git.calls).toEqual([
      'defaultBranch',
      'currentBranch',
      'isClean',
      'fetch:origin',
      'branchStatus',
      'listTags',
      'currentBranch',
      'defaultBranch',
      'stage:CHANGELOG.md',
      'commit:v1.3.0',
      'tag:v1.3.0:v1.3.0',
      'push:origin:main:follow',
    ]);
  });

  test('first release: uses 0.1.0 and firstCommit() as compare base', async () => {
    const fixture = loadFixture('01-first-release');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = [];
    ports.git.rootCommit = 'abcdef0';

    const plan = await run(defaultInputs({ versionArg: '0.1.0' }), ports);

    expect(plan.tagName).toBe('v0.1.0');
    expect(plan.commitMessage).toBe('v0.1.0');
    expect(ports.git.calls).toContain('firstCommit');
    expect(ports.fs.files.get('CHANGELOG.md')).toBe(fixture.expected!);
  });

  test('--dry-run does not write or commit or push', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.2.0'];

    await run(defaultInputs({ versionArg: '1.3.0', dryRun: true }), ports);

    expect(ports.fs.writes).toEqual([]);
    expect(ports.git.calls).not.toContain('stage:CHANGELOG.md');
    expect(ports.git.calls).not.toContain('commit:v1.3.0');
    expect(ports.git.calls).not.toContain('push:origin:main:follow');
  });

  test('--no-tag and --no-push skip the corresponding git calls', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.2.0'];

    await run(defaultInputs({ versionArg: '1.3.0', tag: false, push: false }), ports);

    expect(ports.git.calls).toContain('commit:v1.3.0');
    expect(ports.git.calls).not.toContain('tag:v1.3.0:v1.3.0');
    expect(ports.git.calls.some((c) => c.startsWith('push:'))).toBe(false);
  });

  test('shorthand "minor" expands to candidates.minor', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.2.0'];

    const plan = await run(defaultInputs({ versionArg: 'minor' }), ports);
    expect(plan.nextVersion).toBe('1.3.0');
  });

  test('prerelease previous version → default offers next prerelease', async () => {
    const fixture = loadFixture('05-prerelease-bump');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.0.0-rc.1'];

    const plan = await run(defaultInputs(), ports);
    expect(plan.nextVersion).toBe('1.0.0-rc.2');
    expect(plan.tagName).toBe('v1.0.0-rc.2');
    expect(ports.fs.files.get('CHANGELOG.md')).toBe(fixture.expected!);
  });

  test('detects bare tag prefix and emits bare tag', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['1.0.0', '1.1.0', '1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0' }), ports);
    expect(plan.tagName).toBe('1.3.0');
  });
});

describe('run() — failures', () => {
  let ports: ReturnType<typeof makePorts>;
  beforeEach(() => {
    ports = makePorts();
  });

  test('missing CHANGELOG.md → PubvError(no-changelog)', async () => {
    await expect(run(defaultInputs({ versionArg: '1.0.0' }), ports)).rejects.toBeInstanceOf(
      PubvError,
    );
  });

  test('behind remote → PubvError(behind-remote)', async () => {
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];
    ports.git.upstream = { hasUpstream: true, ahead: 0, behind: 3 };

    try {
      await run(defaultInputs({ versionArg: '1.3.0' }), ports);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PubvError);
      expect((err as PubvError).code).toBe('behind-remote');
    }
  });

  test('off main branch with --yes is allowed (no prompt to abort)', async () => {
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];
    ports.git.branch = 'feature/foo';

    const plan = await run(defaultInputs({ versionArg: '1.3.0' }), ports);
    expect(plan.branch).toBe('feature/foo');
  });

  test('off main branch (interactive) without confirmation → PubvError(wrong-branch)', async () => {
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];
    ports.git.branch = 'feature/foo';
    ports.prompt.script = [{ kind: 'confirm', value: false }];

    try {
      await run(defaultInputs({ yes: false, versionArg: '1.3.0' }), ports);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PubvError);
      expect((err as PubvError).code).toBe('wrong-branch');
    }
  });

  test('invalid version arg → PubvError(invalid-version)', async () => {
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];

    try {
      await run(defaultInputs({ versionArg: 'not-a-version' }), ports);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PubvError);
      expect((err as PubvError).code).toBe('invalid-version');
    }
  });

  test('CHANGELOG without [Unreleased] → PubvError(no-unreleased)', async () => {
    const fixture = loadFixture('07-no-unreleased-error');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.0.0'];

    try {
      await run(defaultInputs({ versionArg: '1.1.0' }), ports);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PubvError);
      expect((err as PubvError).code).toBe('no-unreleased');
    }
  });
});
