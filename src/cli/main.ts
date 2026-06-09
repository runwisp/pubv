import pkg from '../../package.json' with { type: 'json' };
import { createForgeCli } from '../adapters/forge-cli.js';
import { nodeFs } from '../adapters/fs-node.js';
import { createGitCli } from '../adapters/git-cli.js';
import { createHttpHostProber } from '../adapters/host-prober-http.js';
import { createLogger } from '../adapters/logger-ansi.js';
import { createPrompt } from '../adapters/prompt-readline.js';
import { PubvError } from '../core/errors.js';
import { run as runRelease } from '../core/release.js';
import type { HostProber } from '../ports/host-prober.js';
import { parseArgs } from './args.js';
import { helpText } from './help.js';

const PKG_VERSION = (pkg as { version: string }).version;

export async function main(argv: readonly string[]): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(formatError(err));
    return 2;
  }

  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (args.showVersion) {
    process.stdout.write(`${PKG_VERSION}\n`);
    return 0;
  }

  const stdout = process.stdout;
  const isTTY = Boolean(stdout.isTTY);
  const log = createLogger({
    stream: stdout,
    isTTY,
    enableSpinner: isTTY && !args.yes && !process.env.CI,
  });
  const prompt = createPrompt({ input: process.stdin, output: stdout });
  const cwd = process.cwd();
  const git = createGitCli({ cwd });
  const forge = createForgeCli({ cwd });
  const hostProber = makeHostProber(PKG_VERSION);
  const envSkip = process.env.PUBV_NO_PROTECTION_CHECK;

  log.banner('pubv', PKG_VERSION);

  try {
    await runRelease(
      {
        changelogPath: args.changelogPath,
        versionArg: args.version,
        tagPrefixOverride: args.tagPrefix,
        yes: args.yes,
        dryRun: args.dryRun,
        push: args.push,
        tag: args.tag,
        mergeRequest: args.mergeRequest,
        tagRelease: args.tagRelease,
        skipProtectionCheck: args.skipProtectionCheck || (!!envSkip && envSkip !== '0'),
        today: args.date ?? new Date().toISOString().slice(0, 10),
        remote: args.remote,
      },
      { git, fs: nodeFs, prompt, log, forge, hostProber },
    );
    log.blank();
    return 0;
  } catch (err) {
    log.blank();
    if (err instanceof PubvError) {
      log.fail(err.message);
      return err.exitCode;
    }
    log.fail(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * The custom-domain HTTP fingerprint probe, or a no-op (always `null`, →
 * `generic`) when `PUBV_NO_HOST_PROBE` is set — mirrors `PUBV_NO_PROTECTION_CHECK`.
 */
function makeHostProber(version: string): HostProber {
  const off = process.env.PUBV_NO_HOST_PROBE;
  if (off && off !== '0')
    return {
      async classify() {
        return null;
      },
    };
  return createHttpHostProber({ userAgent: `pubv/${version}` });
}

function formatError(err: unknown): string {
  if (err instanceof PubvError) return `pubv: ${err.message}\n`;
  if (err instanceof Error) return `pubv: ${err.message}\n`;
  return `pubv: ${String(err)}\n`;
}
