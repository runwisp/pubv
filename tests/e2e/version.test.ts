import { beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPubv } from '../helpers/repo.js';

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

// Guards the version pipeline end-to-end: `pubv --version` is inlined from
// package.json at build time (see src/cli/main.ts), and the release.yml pipeline
// rewrites package.json from the git tag before `bun run build`. If that chain
// ever breaks, the shipped CLI would lie about its version — this test catches it.
test('pubv --version matches package.json at build time', () => {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  const run = runPubv(['--version'], PROJECT_ROOT);
  expect(run.code).toBe(0);
  expect(run.stdout.trim()).toBe(pkg.version);
});
