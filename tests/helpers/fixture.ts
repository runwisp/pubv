import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReleaseOptions } from '../../src/core/changelog.js';
import type { PubvErrorCode } from '../../src/core/errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '..', 'fixtures');

export interface FixtureMeta extends ReleaseOptions {
  expectError?: PubvErrorCode;
}

export interface Fixture {
  name: string;
  dir: string;
  input: string;
  expected: string | null;
  meta: FixtureMeta;
}

export function loadFixture(name: string): Fixture {
  const dir = join(FIXTURES_DIR, name);
  const input = readFileSync(join(dir, 'changelog-in.md'), 'utf8');
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as FixtureMeta;
  const expected = meta.expectError ? null : readFileSync(join(dir, 'changelog-out.md'), 'utf8');
  return { name, dir, input, expected, meta };
}

export function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => statSync(join(FIXTURES_DIR, name)).isDirectory())
    .sort();
}
