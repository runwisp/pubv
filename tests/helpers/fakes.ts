import type { HostInfo, HostKind } from '../../src/core/host.js';
import type { Forge, ReleaseRequest, ReleaseResult } from '../../src/ports/forge.js';
import type { Fs } from '../../src/ports/fs.js';
import type { BranchStatus, Git, PushOptions, SignOptions } from '../../src/ports/git.js';
import type { HostProber } from '../../src/ports/host-prober.js';
import type { Logger, Spinner } from '../../src/ports/logger.js';
import type { Prompt, SelectOption } from '../../src/ports/prompt.js';

export class FakeFs implements Fs {
  files = new Map<string, string>();
  writes: Array<{ path: string; contents: string }> = [];

  async read(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`FakeFs: file not found: ${path}`);
    return c;
  }
  async write(path: string, contents: string): Promise<void> {
    this.writes.push({ path, contents });
    this.files.set(path, contents);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

export class FakeGit implements Git {
  branch = 'main';
  defaultBranchName = 'main';
  clean = true;
  /** `git remote get-url` result; `null` (default) → CHANGELOG host fallback. */
  remoteUrlValue: string | null = null;
  tags: string[] = [];
  upstream: BranchStatus = { hasUpstream: true, ahead: 0, behind: 0 };
  rootCommit = 'abcdef0';
  fetchShouldFail = false;
  pushShouldFail = false;
  calls: string[] = [];

  async defaultBranch(): Promise<string> {
    this.calls.push('defaultBranch');
    return this.defaultBranchName;
  }
  async currentBranch(): Promise<string> {
    this.calls.push('currentBranch');
    return this.branch;
  }
  async remoteUrl(remote: string): Promise<string | null> {
    this.calls.push(`remoteUrl:${remote}`);
    return this.remoteUrlValue;
  }
  async isClean(): Promise<boolean> {
    this.calls.push('isClean');
    return this.clean;
  }
  async fetch(remote: string): Promise<void> {
    this.calls.push(`fetch:${remote}`);
    if (this.fetchShouldFail) throw new Error('fake fetch failure');
  }
  async branchStatus(_branch: string, _remote: string): Promise<BranchStatus> {
    this.calls.push('branchStatus');
    return this.upstream;
  }
  async listTags(): Promise<string[]> {
    this.calls.push('listTags');
    return this.tags;
  }
  async firstCommit(): Promise<string> {
    this.calls.push('firstCommit');
    return this.rootCommit;
  }
  async stage(path: string): Promise<void> {
    this.calls.push(`stage:${path}`);
  }
  async commit(message: string, options?: SignOptions): Promise<void> {
    this.calls.push(`commit:${message}${options?.sign ? ':signed' : ''}`);
  }
  async tag(name: string, message: string, options?: SignOptions): Promise<void> {
    this.calls.push(`tag:${name}:${message}${options?.sign ? ':signed' : ''}`);
  }
  async push(remote: string, branch: string, options: PushOptions): Promise<void> {
    const flag = options.followTags ? 'follow' : options.setUpstream ? 'upstream' : 'plain';
    this.calls.push(`push:${remote}:${branch}:${flag}`);
    if (this.pushShouldFail) throw new Error('fake push failure');
  }
  async createBranch(name: string): Promise<void> {
    this.calls.push(`createBranch:${name}`);
    this.branch = name;
  }
  async switchBranch(name: string): Promise<void> {
    this.calls.push(`switchBranch:${name}`);
    this.branch = name;
  }
  async pushTag(remote: string, tag: string): Promise<void> {
    this.calls.push(`pushTag:${remote}:${tag}`);
    if (this.pushShouldFail) throw new Error('fake push failure');
  }
}

export class FakeForge implements Forge {
  /** Value returned by `branchProtected` (default: undeterminable). */
  protectedResult: boolean | null = null;
  /** Result returned from `createRelease`; default is a successful creation. */
  releaseResult: ReleaseResult = {
    created: true,
    url: 'https://github.com/owner/repo/releases/v1.0.0',
  };
  requests: ReleaseRequest[] = [];
  calls: string[] = [];

  async branchProtected(_host: HostInfo, branch: string): Promise<boolean | null> {
    this.calls.push(`branchProtected:${branch}`);
    return this.protectedResult;
  }

  async createRelease(req: ReleaseRequest): Promise<ReleaseResult> {
    this.requests.push(req);
    return this.releaseResult;
  }
}

export class FakeHostProber implements HostProber {
  /** Value returned by `classify` (default: undeterminable → `generic`). */
  kind: HostKind | null = null;
  /** Hostnames passed to `classify`, in order — empty unless a probe ran. */
  calls: string[] = [];

  async classify(hostname: string): Promise<HostKind | null> {
    this.calls.push(hostname);
    return this.kind;
  }
}

type ScriptedAnswer =
  | { kind: 'confirm'; value: boolean }
  | { kind: 'input'; value: string }
  | { kind: 'select'; value: string };

export class FakePrompt implements Prompt {
  /** Push answers in the order they will be consumed. */
  script: ScriptedAnswer[] = [];

  async confirm(_message: string, defaultYes: boolean): Promise<boolean> {
    const next = this.script.shift();
    if (!next) return defaultYes;
    if (next.kind !== 'confirm') throw new Error(`FakePrompt: expected confirm, got ${next.kind}`);
    return next.value;
  }
  async input(_message: string, defaultValue: string): Promise<string> {
    const next = this.script.shift();
    if (!next) return defaultValue;
    if (next.kind !== 'input') throw new Error(`FakePrompt: expected input, got ${next.kind}`);
    return next.value;
  }
  async select<K extends string>(
    _message: string,
    _options: ReadonlyArray<SelectOption<K>>,
    defaultKey: K,
  ): Promise<K> {
    const next = this.script.shift();
    if (!next) return defaultKey;
    if (next.kind !== 'select') throw new Error(`FakePrompt: expected select, got ${next.kind}`);
    return next.value as K;
  }
}

export class SilentLogger implements Logger {
  events: Array<{ kind: string; args: unknown[] }> = [];

  private record(kind: string, args: unknown[]): void {
    this.events.push({ kind, args });
  }
  banner(name: string, version: string): void {
    this.record('banner', [name, version]);
  }
  section(name: string): void {
    this.record('section', [name]);
  }
  ok(message: string): void {
    this.record('ok', [message]);
  }
  warn(message: string): void {
    this.record('warn', [message]);
  }
  fail(message: string): void {
    this.record('fail', [message]);
  }
  info(message: string): void {
    this.record('info', [message]);
  }
  line(text: string): void {
    this.record('line', [text]);
  }
  kv(key: string, value: string, note?: string): void {
    this.record('kv', [key, value, note]);
  }
  blank(): void {
    this.record('blank', []);
  }
  spinner(message: string): Spinner {
    this.record('spinner-start', [message]);
    return {
      succeed: (msg?: string) => this.record('spinner-succeed', [msg]),
      fail: (msg?: string) => this.record('spinner-fail', [msg]),
      stop: () => this.record('spinner-stop', []),
    };
  }
}
