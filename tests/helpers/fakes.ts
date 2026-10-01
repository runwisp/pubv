import type { HostInfo, HostKind } from '../../src/core/host.js';
import type { Forge, ReleaseRequest, ReleaseResult } from '../../src/ports/forge.js';
import type { Fs } from '../../src/ports/fs.js';
import type { BranchStatus, Git, PushOptions, SignOptions } from '../../src/ports/git.js';
import type { HostProber } from '../../src/ports/host-prober.js';
import type { Logger, Spinner } from '../../src/ports/logger.js';
import type { Prompt, SelectCustom, SelectOption } from '../../src/ports/prompt.js';

export class FakeFs implements Fs {
  files = new Map<string, string>();
  writes: Array<{ path: string; contents: string }> = [];

  read(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) return Promise.reject(new Error(`FakeFs: file not found: ${path}`));
    return Promise.resolve(c);
  }
  write(path: string, contents: string): Promise<void> {
    this.writes.push({ path, contents });
    this.files.set(path, contents);
    return Promise.resolve();
  }
  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
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
  pullShouldFail = false;
  calls: string[] = [];

  defaultBranch(): Promise<string> {
    this.calls.push('defaultBranch');
    return Promise.resolve(this.defaultBranchName);
  }
  currentBranch(): Promise<string> {
    this.calls.push('currentBranch');
    return Promise.resolve(this.branch);
  }
  remoteUrl(remote: string): Promise<string | null> {
    this.calls.push(`remoteUrl:${remote}`);
    return Promise.resolve(this.remoteUrlValue);
  }
  isClean(): Promise<boolean> {
    this.calls.push('isClean');
    return Promise.resolve(this.clean);
  }
  fetch(remote: string): Promise<void> {
    this.calls.push(`fetch:${remote}`);
    if (this.fetchShouldFail) return Promise.reject(new Error('fake fetch failure'));
    return Promise.resolve();
  }
  branchStatus(_branch: string, _remote: string): Promise<BranchStatus> {
    this.calls.push('branchStatus');
    return Promise.resolve(this.upstream);
  }
  pull(remote: string, branch: string): Promise<void> {
    this.calls.push(`pull:${remote}:${branch}`);
    if (this.pullShouldFail) return Promise.reject(new Error('fake pull failure'));
    return Promise.resolve();
  }
  listTags(): Promise<string[]> {
    this.calls.push('listTags');
    return Promise.resolve(this.tags);
  }
  firstCommit(): Promise<string> {
    this.calls.push('firstCommit');
    return Promise.resolve(this.rootCommit);
  }
  stage(path: string): Promise<void> {
    this.calls.push(`stage:${path}`);
    return Promise.resolve();
  }
  commit(message: string, options?: SignOptions): Promise<void> {
    this.calls.push(`commit:${message}${options?.sign ? ':signed' : ''}`);
    return Promise.resolve();
  }
  tag(name: string, message: string, options?: SignOptions): Promise<void> {
    this.calls.push(`tag:${name}:${message}${options?.sign ? ':signed' : ''}`);
    return Promise.resolve();
  }
  push(remote: string, branch: string, options: PushOptions): Promise<void> {
    let flag = 'plain';
    if (options.followTags) flag = 'follow';
    else if (options.setUpstream) flag = 'upstream';
    this.calls.push(`push:${remote}:${branch}:${flag}`);
    if (this.pushShouldFail) return Promise.reject(new Error('fake push failure'));
    return Promise.resolve();
  }
  createBranch(name: string): Promise<void> {
    this.calls.push(`createBranch:${name}`);
    this.branch = name;
    return Promise.resolve();
  }
  switchBranch(name: string): Promise<void> {
    this.calls.push(`switchBranch:${name}`);
    this.branch = name;
    return Promise.resolve();
  }
  pushTag(remote: string, tag: string): Promise<void> {
    this.calls.push(`pushTag:${remote}:${tag}`);
    if (this.pushShouldFail) return Promise.reject(new Error('fake push failure'));
    return Promise.resolve();
  }
}

export class FakeForge implements Forge {
  /** Value returned by `branchProtected` (default: undeterminable). */
  protectedResult: boolean | 'cli-missing' | null = null;
  /** Result returned from `createRelease`; default is a successful creation. */
  releaseResult: ReleaseResult = {
    created: true,
    url: 'https://github.com/owner/repo/releases/v1.0.0',
  };
  requests: ReleaseRequest[] = [];
  calls: string[] = [];

  branchProtected(_host: HostInfo, branch: string): Promise<boolean | 'cli-missing' | null> {
    this.calls.push(`branchProtected:${branch}`);
    return Promise.resolve(this.protectedResult);
  }

  createRelease(req: ReleaseRequest): Promise<ReleaseResult> {
    this.requests.push(req);
    return Promise.resolve(this.releaseResult);
  }
}

export class FakeHostProber implements HostProber {
  /** Value returned by `classify` (default: undeterminable → `generic`). */
  kind: HostKind | null = null;
  /** Hostnames passed to `classify`, in order — empty unless a probe ran. */
  calls: string[] = [];

  classify(hostname: string): Promise<HostKind | null> {
    this.calls.push(hostname);
    return Promise.resolve(this.kind);
  }
}

type ScriptedAnswer =
  | { kind: 'confirm'; value: boolean }
  | { kind: 'input'; value: string }
  | { kind: 'select'; value: string };

export class FakePrompt implements Prompt {
  /** Push answers in the order they will be consumed. */
  script: ScriptedAnswer[] = [];

  confirm(_message: string, defaultYes: boolean): Promise<boolean> {
    return this.take('confirm', defaultYes);
  }
  input(_message: string, defaultValue: string): Promise<string> {
    return this.take('input', defaultValue);
  }
  select<K extends string>(
    _message: string,
    _options: ReadonlyArray<SelectOption<K>>,
    defaultKey: K,
    _custom?: SelectCustom,
  ): Promise<K | string> {
    return this.take('select', defaultKey);
  }

  private take<T>(kind: ScriptedAnswer['kind'], fallback: T): Promise<T> {
    const next = this.script.shift();
    if (!next) return Promise.resolve(fallback);
    if (next.kind !== kind) {
      return Promise.reject(new Error(`FakePrompt: expected ${kind}, got ${next.kind}`));
    }
    return Promise.resolve(next.value as T);
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
