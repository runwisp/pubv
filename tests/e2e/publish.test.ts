import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../helpers/fixture.js';
import { type TempRepo, makeRepo, runPubv } from '../helpers/repo.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const BIN = join(PROJECT_ROOT, 'dist', 'bin.js');

beforeAll(() => {
  if (!existsSync(BIN)) {
    const r = spawnSync('bun', ['run', 'build'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error('failed to build dist/bin.js before e2e tests');
  }
});

describe('e2e: pubv against a real git repo', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  function track(repo: TempRepo): TempRepo {
    cleanups.push(() => repo.cleanup());
    return repo;
  }

  test('graduates a minor release end-to-end and pushes to origin', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(
      await makeRepo({
        changelogContent: fx.input,
        initialTags: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
      }),
    );

    const run = runPubv(['--yes', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(run.code).toBe(0);

    const written = readFileSync(join(repo.dir, 'CHANGELOG.md'), 'utf8');
    expect(written).toBe(fx.expected!);

    const localTags = repo.git(['tag', '--list']).stdout.trim().split('\n').sort();
    expect(localTags).toContain('v1.3.0');

    expect(repo.git(['log', '-1', '--pretty=%s']).stdout.trim()).toBe('v1.3.0');

    const remoteTags = repo.remoteGit(['tag', '--list']).stdout.trim().split('\n').sort();
    expect(remoteTags).toContain('v1.3.0');

    const remoteHead = repo.remoteGit(['log', '-1', '--pretty=%s', 'main']).stdout.trim();
    expect(remoteHead).toBe('v1.3.0');
  });

  test('--dry-run does not touch the repo', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(await makeRepo({ changelogContent: fx.input, initialTags: ['v1.2.0'] }));

    const before = readFileSync(join(repo.dir, 'CHANGELOG.md'), 'utf8');
    const tagsBefore = repo.git(['tag', '--list']).stdout;
    const headBefore = repo.git(['rev-parse', 'HEAD']).stdout.trim();

    const run = runPubv(['--yes', '--dry-run', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(run.code).toBe(0);

    expect(readFileSync(join(repo.dir, 'CHANGELOG.md'), 'utf8')).toBe(before);
    expect(repo.git(['tag', '--list']).stdout).toBe(tagsBefore);
    expect(repo.git(['rev-parse', 'HEAD']).stdout.trim()).toBe(headBefore);
  });

  test('--no-push leaves the remote behind but tags locally', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(await makeRepo({ changelogContent: fx.input, initialTags: ['v1.2.0'] }));
    const remoteHeadBefore = repo.remoteGit(['rev-parse', 'main']).stdout.trim();

    const run = runPubv(['--yes', '--no-push', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(run.code).toBe(0);

    expect(repo.git(['tag', '--list']).stdout.trim()).toContain('v1.3.0');
    expect(repo.remoteGit(['rev-parse', 'main']).stdout.trim()).toBe(remoteHeadBefore);
  });

  test('--no-tag commits without creating a tag', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(await makeRepo({ changelogContent: fx.input, initialTags: ['v1.2.0'] }));

    const run = runPubv(['--yes', '--no-tag', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(run.code).toBe(0);

    expect(repo.git(['log', '-1', '--pretty=%s']).stdout.trim()).toBe('v1.3.0');
    const tags = repo.git(['tag', '--list']).stdout.trim().split('\n').filter(Boolean);
    expect(tags).not.toContain('v1.3.0');
  });

  test('detects bare tag prefix from existing tags', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(
      await makeRepo({
        changelogContent: fx.input,
        initialTags: ['1.0.0', '1.1.0', '1.2.0'],
      }),
    );

    const run = runPubv(['--yes', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(run.code).toBe(0);

    expect(repo.git(['tag', '--list']).stdout.trim().split('\n')).toContain('1.3.0');
  });

  test('--merge-request opens a release branch + MR, then --tag-release tags the merge', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(await makeRepo({ changelogContent: fx.input, initialTags: ['v1.2.0'] }));

    // Step 1: open the release branch + merge request.
    const mr = runPubv(['--yes', '--merge-request', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(mr.code).toBe(0);
    expect(mr.stdout).toContain('compare/main...release%2Fv1.3.0?expand=1');

    // We are back on main with the original changelog and a clean tree; no tag yet.
    expect(repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('main');
    expect(readFileSync(join(repo.dir, 'CHANGELOG.md'), 'utf8')).toBe(fx.input);
    expect(repo.git(['status', '--porcelain']).stdout.trim()).toBe('');
    expect(repo.git(['tag', '--list']).stdout).not.toContain('v1.3.0');

    // The release branch was pushed with the graduated changelog.
    const remoteBranches = repo.remoteGit(['branch', '--list']).stdout;
    expect(remoteBranches).toContain('release/v1.3.0');

    // Step 2: simulate merging the MR into main, then tag the merge commit.
    expect(
      repo.git(['merge', '--no-ff', '-m', 'Merge release/v1.3.0', 'release/v1.3.0']).status,
    ).toBe(0);
    expect(readFileSync(join(repo.dir, 'CHANGELOG.md'), 'utf8')).toBe(fx.expected!);
    expect(repo.git(['push', '-q', 'origin', 'main']).status).toBe(0);

    const tagRun = runPubv(['--yes', '--tag-release', '--date=2026-05-25'], repo.dir);
    expect(tagRun.code).toBe(0);

    expect(repo.git(['tag', '--list']).stdout.trim().split('\n')).toContain('v1.3.0');
    const remoteTags = repo.remoteGit(['tag', '--list']).stdout.trim().split('\n');
    expect(remoteTags).toContain('v1.3.0');
    // The tag points at the merge commit on main.
    expect(repo.git(['rev-parse', 'v1.3.0^{commit}']).stdout.trim()).toBe(
      repo.git(['rev-parse', 'main']).stdout.trim(),
    );
  });

  test('--tag-release fails when the tag already exists', async () => {
    const fx = loadFixture('02-minor-added');
    // Changelog already graduated to 1.3.0, and the tag is already present.
    const repo = track(
      await makeRepo({ changelogContent: fx.expected!, initialTags: ['v1.2.0', 'v1.3.0'] }),
    );

    const run = runPubv(['--yes', '--tag-release', '--date=2026-05-25'], repo.dir);
    expect(run.code).not.toBe(0);
  });

  test('aborts with non-zero exit on invalid version', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(await makeRepo({ changelogContent: fx.input, initialTags: ['v1.2.0'] }));

    const run = runPubv(['--yes', '--date=2026-05-25', 'not-a-version'], repo.dir);
    expect(run.code).not.toBe(0);
  });

  test('prints the locked visual style (banner, sections, ok marks)', async () => {
    const fx = loadFixture('02-minor-added');
    const repo = track(await makeRepo({ changelogContent: fx.input, initialTags: ['v1.2.0'] }));

    const run = runPubv(['--yes', '--dry-run', '--date=2026-05-25', '1.3.0'], repo.dir);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('pubv');
    expect(run.stdout).toMatch(/── preflight /);
    expect(run.stdout).toMatch(/── plan /);
    expect(run.stdout).toMatch(/── dry-run /);
    expect(run.stdout).toContain('✓');
    expect(run.stdout).toMatch(/last\s+1\.2\.0/);
    expect(run.stdout).toMatch(/minor\s+1\.3\.0/);
  });
});
