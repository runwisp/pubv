import { beforeEach, describe, expect, test } from 'bun:test';
import { PubvError } from '../../src/core/errors.js';
import { type Ports, type ReleaseInputs, run, runInit } from '../../src/core/release.js';
import { FakeForge, FakeFs, FakeGit, FakePrompt, SilentLogger } from '../helpers/fakes.js';
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
    sign: false,
    release: false,
    allowEmpty: false,
    mergeRequest: false,
    tagRelease: false,
    today: '2026-05-25',
    remote: 'origin',
    ...overrides,
  };
}

function makePorts(): Ports & {
  fs: FakeFs;
  git: FakeGit;
  prompt: FakePrompt;
  log: SilentLogger;
  forge: FakeForge;
} {
  return {
    fs: new FakeFs(),
    git: new FakeGit(),
    prompt: new FakePrompt(),
    log: new SilentLogger(),
    forge: new FakeForge(),
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

  test('detects bare tag prefix and emits bare tag + bare commit message', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['1.0.0', '1.1.0', '1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0' }), ports);
    expect(plan.tagName).toBe('1.3.0');
    expect(plan.commitMessage).toBe('1.3.0');
    expect(ports.git.calls).toContain('commit:1.3.0');
    expect(ports.git.calls).toContain('tag:1.3.0:1.3.0');
  });

  test('adopts a custom prefix embedded in the version arg', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['myapp.1.0.0', 'myapp.1.2.0'];

    const plan = await run(defaultInputs({ versionArg: 'myapp.1.3.0' }), ports);

    expect(plan.nextVersion).toBe('1.3.0');
    expect(plan.tagName).toBe('myapp.1.3.0');
    expect(plan.commitMessage).toBe('myapp.1.3.0');
    expect(plan.newChangelog).toContain('## [myapp.1.3.0] - 2026-05-25');
    expect(ports.git.calls).toContain('tag:myapp.1.3.0:myapp.1.3.0');
  });

  test('auto-detects a custom prefix from existing tags with a shorthand bump', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['myapp.1.0.0', 'myapp.1.2.0'];

    const plan = await run(defaultInputs({ versionArg: 'minor' }), ports);

    expect(plan.nextVersion).toBe('1.3.0');
    expect(plan.tagName).toBe('myapp.1.3.0');
    expect(plan.commitMessage).toBe('myapp.1.3.0');
  });

  test('plan carries the [Unreleased] body and previews it in the log', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0' }), ports);

    expect(plan.entries).toEqual([
      '### Added',
      '',
      '- Lifecycle hooks for plugins.',
      '',
      '### Changed',
      '',
      '- Internal retry logic now uses exponential backoff.',
    ]);

    // A `changes` section is emitted, followed by one `line` per body line.
    const changesIdx = ports.log.events.findIndex(
      (e) => e.kind === 'section' && e.args[0] === 'changes',
    );
    expect(changesIdx).toBeGreaterThanOrEqual(0);
    const lineEvents = ports.log.events
      .slice(changesIdx + 1)
      .filter((e) => e.kind === 'line')
      .map((e) => e.args[0]);
    expect(lineEvents).toEqual(plan.entries);

    // The preview comes before the `plan` section (and thus before the
    // version prompt), so the user can pick a version from the entries.
    const planIdx = ports.log.events.findIndex((e) => e.kind === 'section' && e.args[0] === 'plan');
    expect(planIdx).toBeGreaterThan(changesIdx);
  });

  test('empty [Unreleased] body warns instead of previewing entries (--allow-empty)', async () => {
    ports.fs.files.set(
      'CHANGELOG.md',
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '## [1.2.0] - 2026-04-01',
        '',
        '### Added',
        '',
        '- Initial plugin API.',
        '',
        '[Unreleased]: https://github.com/acme/widget/compare/v1.2.0...main',
        '[1.2.0]: https://github.com/acme/widget/compare/v1.1.0...v1.2.0',
        '',
      ].join('\n'),
    );
    ports.git.tags = ['v1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0', allowEmpty: true }), ports);

    expect(plan.entries).toEqual([]);
    const changesIdx = ports.log.events.findIndex(
      (e) => e.kind === 'section' && e.args[0] === 'changes',
    );
    expect(changesIdx).toBeGreaterThanOrEqual(0);
    expect(ports.log.events.slice(changesIdx + 1).some((e) => e.kind === 'warn')).toBe(true);
    expect(ports.log.events.slice(changesIdx + 1).some((e) => e.kind === 'line')).toBe(false);
  });

  test('empty [Unreleased] on an existing changelog → PubvError(empty-release)', async () => {
    ports.fs.files.set(
      'CHANGELOG.md',
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '## [1.2.0] - 2026-04-01',
        '',
        '- Initial.',
        '',
        '[Unreleased]: https://github.com/acme/widget/compare/v1.2.0...main',
        '',
      ].join('\n'),
    );
    ports.git.tags = ['v1.2.0'];

    await expect(run(defaultInputs({ versionArg: '1.3.0' }), ports)).rejects.toMatchObject({
      code: 'empty-release',
    });
  });
});

describe('run() — merge-request mode', () => {
  let ports: ReturnType<typeof makePorts>;
  beforeEach(() => {
    ports = makePorts();
  });

  test('opens a release branch + MR instead of tagging/pushing the default branch', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.input);
    ports.git.tags = ['v1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0', mergeRequest: true }), ports);

    expect(plan.mode).toBe('merge-request');
    expect(plan.releaseBranch).toBe('release/v1.3.0');
    expect(plan.tag).toBe(false);
    expect(plan.mrUrl).toBe(
      'https://github.com/acme/widget/compare/main...release%2Fv1.3.0?expand=1',
    );

    expect(ports.fs.files.get('CHANGELOG.md')).toBe(fixture.expected!);
    expect(ports.git.calls).toContain('createBranch:release/v1.3.0');
    expect(ports.git.calls).toContain('commit:v1.3.0');
    expect(ports.git.calls).toContain('push:origin:release/v1.3.0:upstream');
    expect(ports.git.calls).toContain('switchBranch:main');
    expect(ports.git.calls.some((c) => c.startsWith('tag:'))).toBe(false);
    expect(ports.git.calls).not.toContain('push:origin:main:follow');
  });
});

describe('run() — tag-release mode', () => {
  let ports: ReturnType<typeof makePorts>;
  beforeEach(() => {
    ports = makePorts();
  });

  test('tags the latest changelog release on HEAD and pushes the tag', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.expected!);
    ports.git.tags = ['v1.2.0'];

    const plan = await run(defaultInputs({ tagRelease: true }), ports);

    expect(plan.tagName).toBe('v1.3.0');
    expect(plan.commitMessage).toBe('v1.3.0');
    expect(ports.git.calls).toContain('tag:v1.3.0:v1.3.0');
    expect(ports.git.calls).toContain('pushTag:origin:v1.3.0');
    // No changelog rewrite or commit in this mode.
    expect(ports.fs.writes).toEqual([]);
    expect(ports.git.calls.some((c) => c.startsWith('commit:'))).toBe(false);
  });

  test('--no-push tags without pushing', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.expected!);
    ports.git.tags = ['v1.2.0'];

    await run(defaultInputs({ tagRelease: true, push: false }), ports);

    expect(ports.git.calls).toContain('tag:v1.3.0:v1.3.0');
    expect(ports.git.calls.some((c) => c.startsWith('pushTag:'))).toBe(false);
  });

  test('existing tag → PubvError(tag-exists)', async () => {
    const fixture = loadFixture('02-minor-added');
    ports.fs.files.set('CHANGELOG.md', fixture.expected!);
    ports.git.tags = ['v1.2.0', 'v1.3.0'];

    try {
      await run(defaultInputs({ tagRelease: true }), ports);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PubvError);
      expect((err as PubvError).code).toBe('tag-exists');
    }
  });

  test('no released version → PubvError(no-release)', async () => {
    ports.fs.files.set('CHANGELOG.md', loadFixture('01-first-release').input);
    ports.git.tags = [];

    try {
      await run(defaultInputs({ tagRelease: true }), ports);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PubvError);
      expect((err as PubvError).code).toBe('no-release');
    }
  });
});

describe('run() — failures', () => {
  let ports: ReturnType<typeof makePorts>;
  beforeEach(() => {
    ports = makePorts();
  });

  test('missing CHANGELOG.md without a forge URL → PubvError(no-host)', async () => {
    // No file and no remote to seed a forge URL: host detection fails.
    ports.git.remote = null;
    await expect(run(defaultInputs({ versionArg: '1.0.0' }), ports)).rejects.toMatchObject({
      code: 'no-host',
    });
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

describe('run() — --sign', () => {
  test('signs the commit and the tag', async () => {
    const ports = makePorts();
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];

    await run(defaultInputs({ versionArg: '1.3.0', sign: true }), ports);

    expect(ports.git.calls).toContain('commit:v1.3.0:signed');
    expect(ports.git.calls).toContain('tag:v1.3.0:v1.3.0:signed');
  });
});

describe('run() — --release (forge)', () => {
  test('creates a forge release with the graduated entries as notes', async () => {
    const ports = makePorts();
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];

    const plan = await run(defaultInputs({ versionArg: '1.3.0', release: true }), ports);

    expect(ports.forge.requests).toHaveLength(1);
    expect(ports.forge.requests[0]!.tag).toBe('v1.3.0');
    expect(ports.forge.requests[0]!.title).toBe('v1.3.0');
    expect(ports.forge.requests[0]!.notes).toBe(plan.entries.join('\n'));
  });

  test('a failed release does not abort the run', async () => {
    const ports = makePorts();
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];
    ports.forge.result = { created: false, reason: 'gh not available' };

    const plan = await run(defaultInputs({ versionArg: '1.3.0', release: true }), ports);

    expect(plan.tagName).toBe('v1.3.0');
    expect(ports.log.events.some((e) => e.kind === 'warn')).toBe(true);
  });

  test('no forge release when --release is not set', async () => {
    const ports = makePorts();
    ports.fs.files.set('CHANGELOG.md', loadFixture('02-minor-added').input);
    ports.git.tags = ['v1.2.0'];

    await run(defaultInputs({ versionArg: '1.3.0' }), ports);

    expect(ports.forge.requests).toHaveLength(0);
  });
});

describe('run() — auto-scaffold on missing changelog', () => {
  test('scaffolds and cuts the first release (0.1.0)', async () => {
    const ports = makePorts();
    ports.git.remote = 'https://github.com/owner/repo';

    const plan = await run(defaultInputs(), ports);

    expect(plan.createChangelog).toBe(true);
    expect(plan.nextVersion).toBe('0.1.0');
    expect(plan.tagName).toBe('v0.1.0');
    expect(ports.git.calls).toContain('remoteUrl:origin');
    expect(ports.fs.files.has('CHANGELOG.md')).toBe(true);
    expect(ports.fs.files.get('CHANGELOG.md')).toContain('# Changelog');
    // empty-guard is skipped on the bootstrap path even with an empty body
    expect(plan.entries).toEqual([]);
  });
});

describe('runInit', () => {
  test('writes the scaffold without committing', async () => {
    const ports = makePorts();
    ports.git.remote = 'https://github.com/owner/repo';

    await runInit(defaultInputs(), ports);

    const content = ports.fs.files.get('CHANGELOG.md');
    expect(content).toContain('# Changelog');
    expect(content).toContain('[Unreleased]: https://github.com/owner/repo');
    expect(ports.git.calls.some((c) => c.startsWith('commit'))).toBe(false);
    expect(ports.git.calls.some((c) => c.startsWith('tag'))).toBe(false);
  });

  test('errors when the changelog already exists', async () => {
    const ports = makePorts();
    ports.fs.files.set('CHANGELOG.md', '# Changelog\n');

    await expect(runInit(defaultInputs(), ports)).rejects.toMatchObject({
      code: 'changelog-exists',
    });
  });
});
