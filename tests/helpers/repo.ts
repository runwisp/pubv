import { type SpawnSyncOptions, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const BIN = resolve(PROJECT_ROOT, 'dist', 'bin.js');

export interface MakeRepoOptions {
  changelogContent: string;
  /** Tags to create on the initial commit, in order. */
  initialTags?: string[];
}

export interface TempRepo {
  /** Working tree root. */
  dir: string;
  /** Bare remote path (used as `origin`). */
  remote: string;
  git(args: string[], options?: Pick<SpawnSyncOptions, 'cwd'>): SpawnSyncReturns<string>;
  /** Run `git --git-dir=<remote.git> <args>` to inspect the bare remote. */
  remoteGit(args: string[]): SpawnSyncReturns<string>;
  cleanup(): Promise<void>;
}

export async function makeRepo(opts: MakeRepoOptions): Promise<TempRepo> {
  const root = await mkdtemp(join(tmpdir(), 'pubv-e2e-'));
  const dir = join(root, 'work');
  const remote = join(root, 'remote.git');

  await mkdir(dir, { recursive: true });

  const baseEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const inDir = (cwd: string) => (args: string[]) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', env: baseEnv });

  const runInRepo = inDir(dir);

  spawnSync('git', ['init', '-q', '--bare', '--initial-branch=main', remote], { env: baseEnv });
  runInRepo(['init', '-q', '--initial-branch=main']);
  runInRepo(['config', 'commit.gpgsign', 'false']);
  runInRepo(['config', 'tag.gpgsign', 'false']);
  runInRepo(['remote', 'add', 'origin', remote]);

  await writeFile(join(dir, 'CHANGELOG.md'), opts.changelogContent);
  runInRepo(['add', 'CHANGELOG.md']);
  runInRepo(['commit', '-q', '-m', 'initial']);

  for (const tag of opts.initialTags ?? []) {
    runInRepo(['tag', '-a', tag, '-m', tag]);
  }

  runInRepo(['push', '-q', '-u', 'origin', 'main']);
  if (opts.initialTags?.length) {
    runInRepo(['push', '-q', 'origin', '--tags']);
  }

  return {
    dir,
    remote,
    git(args, options) {
      return spawnSync('git', args, {
        cwd: options?.cwd ?? dir,
        encoding: 'utf8',
        env: baseEnv,
      });
    },
    remoteGit(args) {
      return spawnSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8', env: baseEnv });
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export interface PubvRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runPubv(args: readonly string[], cwd: string): PubvRun {
  const r = spawnSync('node', [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      CI: '1',
      // Keep e2e hermetic: never shell out to gh/glab for protection detection.
      PUBV_NO_PROTECTION_CHECK: '1',
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
