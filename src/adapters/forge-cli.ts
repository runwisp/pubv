import { spawn } from 'node:child_process';
import type { Forge, ReleaseRequest, ReleaseResult } from '../ports/forge.js';

export interface ForgeCliOptions {
  cwd: string;
}

export function createForgeCli(opts: ForgeCliOptions): Forge {
  return {
    async createRelease(req: ReleaseRequest): Promise<ReleaseResult> {
      const cmd = commandFor(req);
      if (!cmd) {
        return { created: false, reason: `no release CLI for ${req.host.kind}` };
      }

      try {
        // Notes go in on stdin so we never have to shell-escape multi-line bodies.
        const out = await exec(cmd.bin, cmd.args, req.notes, opts.cwd);
        const url = firstUrl(out);
        return url ? { created: true, url } : { created: true };
      } catch (err) {
        const reason = err instanceof CliError ? err.detail : String(err);
        return { created: false, reason };
      }
    },
  };
}

interface ForgeCommand {
  bin: string;
  args: string[];
}

function commandFor(req: ReleaseRequest): ForgeCommand | null {
  switch (req.host.kind) {
    case 'github':
    case 'generic':
      // `gh` works against GitHub Enterprise too; treat generic git hosts as a best-effort gh target.
      return {
        bin: 'gh',
        args: ['release', 'create', req.tag, '--title', req.title, '--notes-file', '-'],
      };
    case 'gitlab':
      return {
        bin: 'glab',
        args: ['release', 'create', req.tag, '--name', req.title, '--notes-file', '-'],
      };
    case 'bitbucket':
      return null;
  }
}

const URL_RE = /https?:\/\/\S+/;

function firstUrl(text: string): string | undefined {
  const m = URL_RE.exec(text);
  return m ? m[0] : undefined;
}

class CliError extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

function exec(bin: string, args: string[], stdin: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.once('error', (err) => {
      // ENOENT here means the CLI isn't installed.
      reject(new CliError(`${bin} not available: ${err.message}`));
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new CliError(stderr.trim() || `${bin} exited ${code}`));
      }
    });
    child.stdin.end(stdin);
  });
}
