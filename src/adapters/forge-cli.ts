import { spawn } from 'node:child_process';
import type { HostInfo } from '../core/host.js';
import type { Forge, ReleaseRequest, ReleaseResult } from '../ports/forge.js';

export interface ForgeCliOptions {
  cwd: string;
  /** Kill the CLI and give up (→ `null`) after this many ms. */
  timeoutMs?: number;
}

export interface ForgeQuery {
  cmd: string;
  args: string[];
  /** Extra env merged over the process env (e.g. `GITLAB_HOST`). */
  env?: Record<string, string>;
}

/**
 * Build the forge-CLI invocation that prints whether `branch` is protected
 * (`true` / `false` via `--jq .protected`), or `null` when the host has no
 * supported CLI. Pure, so command construction is testable without a real CLI.
 *
 * `host.base` is `https://<host>/<owner>/<repo>`; we recover the parts from it
 * rather than widening `HostInfo`.
 */
export function forgeQuery(host: HostInfo, branch: string): ForgeQuery | null {
  let url: URL;
  try {
    url = new URL(host.base);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[0]!;
  const repo = segments[1]!;
  // Keep any non-standard port: self-hosted instances aren't always on 443.
  const hostname = url.host;

  switch (host.kind) {
    case 'github': {
      const args = ['api', `repos/${owner}/${repo}/branches/${branch}`, '--jq', '.protected'];
      // `gh` defaults to github.com; point it at an Enterprise host otherwise.
      if (hostname !== 'github.com') args.push('--hostname', hostname);
      return { cmd: 'gh', args };
    }
    case 'gitlab': {
      // GitLab's project id is the full, URL-encoded path — subgroups included
      // (`group/sub/proj` → `group%2Fsub%2Fproj`), not just `owner/repo`.
      const project = segments.map(encodeURIComponent).join('%2F');
      const path = `projects/${project}/repository/branches/${encodeURIComponent(branch)}`;
      // `glab` resolves its host from the git remote or GITLAB_HOST; set the
      // latter so self-hosted instances are targeted explicitly.
      return {
        cmd: 'glab',
        args: ['api', path, '--jq', '.protected'],
        env: { GITLAB_HOST: hostname },
      };
    }
    default:
      return null;
  }
}

export function createForgeCli(opts: ForgeCliOptions): Forge {
  const timeoutMs = opts.timeoutMs ?? 5000;

  return {
    async branchProtected(host, branch) {
      const query = forgeQuery(host, branch);
      if (!query) return null;
      try {
        const out = await execForge(query, opts.cwd, timeoutMs);
        const t = out.trim();
        if (t === 'true') return true;
        if (t === 'false') return false;
        return null;
      } catch (err) {
        // A missing CLI (ENOENT) is worth flagging so the user knows the check
        // was skippable; everything else (not authenticated, 404, timeout,
        // unparseable) maps to "can't tell" and proceeds with a push.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'cli-missing';
        return null;
      }
    },

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

function execForge(query: ForgeQuery, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(query.cmd, query.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...query.env },
      timeout: timeoutMs,
    });
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.once('error', (err) => reject(err));
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${query.cmd} exited with ${code ?? 'signal'}`));
    });
  });
}
