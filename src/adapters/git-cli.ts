import { spawn } from 'node:child_process';
import { PubvError } from '../core/errors.js';
import type { BranchStatus, Git, PushOptions } from '../ports/git.js';

export interface GitCliOptions {
  cwd: string;
}

export function createGitCli(opts: GitCliOptions): Git {
  const run = (args: string[]) => execGit(args, opts.cwd);

  return {
    async defaultBranch() {
      try {
        const out = await run(['symbolic-ref', 'refs/remotes/origin/HEAD']);
        return out.trim().replace(/^refs\/remotes\/origin\//, '');
      } catch {
        // No origin/HEAD yet — fall back to a reasonable default.
        return 'main';
      }
    },

    async currentBranch() {
      return (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    },

    async isClean() {
      const out = await run(['status', '--porcelain']);
      return out.trim() === '';
    },

    async fetch(remote) {
      await run(['fetch', remote]);
    },

    async pull(remote, branch) {
      await run(['merge', '--ff-only', `${remote}/${branch}`]);
    },

    async branchStatus(branch, remote): Promise<BranchStatus> {
      try {
        await run(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`]);
      } catch {
        return { hasUpstream: false, ahead: 0, behind: 0 };
      }
      const out = await run([
        'rev-list',
        '--left-right',
        '--count',
        `${remote}/${branch}...${branch}`,
      ]);
      const [behind = '0', ahead = '0'] = out.trim().split(/\s+/);
      return { hasUpstream: true, ahead: Number(ahead), behind: Number(behind) };
    },

    async listTags() {
      const out = await run(['tag', '--list']);
      return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    },

    async firstCommit() {
      return (await run(['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0]!;
    },

    async stage(path) {
      await run(['add', '--', path]);
    },

    async commit(message) {
      await run(['commit', '-m', message]);
    },

    async tag(name, message) {
      await run(['tag', '-a', name, '-m', message]);
    },

    async push(remote, branch, options: PushOptions) {
      const args = ['push'];
      if (options.followTags) args.push('--follow-tags');
      args.push(remote, branch);
      await run(args);
    },
  };
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.once('error', (err) => reject(err));
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const msg = stderr.trim() || `exit ${code}`;
        reject(new PubvError('git-failure', `git ${args.join(' ')} failed: ${msg}`));
      }
    });
  });
}
