import { spawn } from 'node:child_process';
import type { HostInfo } from '../core/host.js';
import type { Forge } from '../ports/forge.js';

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
  const hostname = url.hostname;

  switch (host.kind) {
    case 'github': {
      const args = ['api', `repos/${owner}/${repo}/branches/${branch}`, '--jq', '.protected'];
      // `gh` defaults to github.com; point it at an Enterprise host otherwise.
      if (hostname !== 'github.com') args.push('--hostname', hostname);
      return { cmd: 'gh', args };
    }
    case 'gitlab': {
      const project = encodeURIComponent(`${owner}/${repo}`);
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
      } catch {
        // Missing CLI (ENOENT), not authenticated, 404, timeout, unparseable —
        // all map to "can't tell", letting the caller proceed with a push.
        return null;
      }
    },
  };
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
