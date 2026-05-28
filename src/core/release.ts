import type { Fs } from '../ports/fs.js';
import type { Git } from '../ports/git.js';
import type { Logger } from '../ports/logger.js';
import type { Prompt } from '../ports/prompt.js';
import {
  type Changelog,
  latestRelease,
  parse,
  serialize,
  release as transformChangelog,
} from './changelog.js';
import { PubvError } from './errors.js';
import { type HostInfo, compareUrl, detectHost, mergeRequestUrl } from './host.js';
import { type TagPrefix, applyPrefix, detectPrefix } from './tag-prefix.js';
import {
  type BumpKind,
  type SemVer,
  bump,
  formatSemver,
  isValidVersionString,
  parseSemver,
  suggestDefault,
} from './version.js';

export interface ReleaseInputs {
  changelogPath: string;
  versionArg: string | null;
  /** `null` → auto-detect from existing tags. */
  tagPrefixOverride: TagPrefix | null;
  yes: boolean;
  dryRun: boolean;
  push: boolean;
  tag: boolean;
  /** Open a release branch + merge request instead of pushing the default branch. */
  mergeRequest: boolean;
  /** Tag the latest changelog release on HEAD and push the tag (post-merge step). */
  tagRelease: boolean;
  /** ISO date `YYYY-MM-DD` used in the new heading. Injectable for tests. */
  today: string;
  remote: string;
}

export type ReleaseMode = 'standard' | 'merge-request';

export interface ReleasePlan {
  changelogPath: string;
  branch: string;
  nextVersion: string;
  tagName: string;
  commitMessage: string;
  date: string;
  /** Verbatim `[Unreleased]` body lines graduating into this release. */
  entries: string[];
  newChangelog: string;
  host: HostInfo;
  push: boolean;
  tag: boolean;
  mode: ReleaseMode;
  /** Branch to commit + push in merge-request mode; `null` in standard mode. */
  releaseBranch: string | null;
  /** "Create merge request" URL printed in merge-request mode; `null` otherwise. */
  mrUrl: string | null;
}

export interface Ports {
  git: Git;
  fs: Fs;
  prompt: Prompt;
  log: Logger;
}

export async function run(inputs: ReleaseInputs, ports: Ports): Promise<ReleasePlan> {
  if (inputs.tagRelease) return runTagRelease(inputs, ports);

  await preflight(inputs, ports);
  const plan = await buildPlan(inputs, ports);
  printPlan(plan, ports.log);

  if (inputs.dryRun) {
    ports.log.section('dry-run');
    ports.log.info('no files written, no commits, no pushes.');
    return plan;
  }

  if (!inputs.yes && !(await confirm(ports, plan))) {
    throw new PubvError('user-aborted', 'aborted by user');
  }

  await applyPlan(plan, inputs, ports);
  return plan;
}

// ─── preflight ─────────────────────────────────────────────────────────────

async function preflight(inputs: ReleaseInputs, ports: Ports): Promise<void> {
  const { fs, git, log, prompt } = ports;

  if (!(await fs.exists(inputs.changelogPath))) {
    throw new PubvError('no-changelog', `${inputs.changelogPath} does not exist`);
  }

  log.section('preflight');

  const defaultBranch = await git.defaultBranch();
  const currentBranch = await git.currentBranch();

  if (currentBranch === defaultBranch) {
    log.ok(`on ${currentBranch}`);
  } else {
    log.warn(`current branch is ${currentBranch}, expected ${defaultBranch}`);
    if (!inputs.yes && !(await prompt.confirm('continue from this branch?', false))) {
      throw new PubvError('wrong-branch', `not on ${defaultBranch}`);
    }
  }

  if (await git.isClean()) {
    log.ok('working tree clean');
  } else {
    log.warn('working tree has uncommitted changes');
    if (!inputs.yes && !(await prompt.confirm('continue with a dirty tree?', false))) {
      throw new PubvError('dirty-tree', 'uncommitted changes present');
    }
  }

  const spinner = log.spinner(`fetching ${inputs.remote}`);
  try {
    await git.fetch(inputs.remote);
    spinner.succeed(`${inputs.remote} fetched`);
  } catch (err) {
    spinner.fail(`could not fetch ${inputs.remote}`);
    throw err;
  }

  const status = await git.branchStatus(currentBranch, inputs.remote);
  if (status.hasUpstream && status.behind > 0) {
    throw new PubvError(
      'behind-remote',
      `${currentBranch} is ${status.behind} commit(s) behind ${inputs.remote}/${currentBranch}`,
    );
  }
  log.ok(status.hasUpstream ? `${inputs.remote} up-to-date` : 'no upstream tracking branch');
}

// ─── plan ──────────────────────────────────────────────────────────────────

async function buildPlan(inputs: ReleaseInputs, ports: Ports): Promise<ReleasePlan> {
  const { fs, git, log, prompt } = ports;

  const source = await fs.read(inputs.changelogPath);
  const cl = parse(source);
  if (!cl.unreleased) {
    throw new PubvError(
      'no-unreleased',
      `${inputs.changelogPath} has no [Unreleased] section to graduate`,
    );
  }

  const host = pickHost(cl);
  const tags = await git.listTags();
  const tagPrefix = await resolveTagPrefix(inputs, tags, prompt);
  const suggestions = computeSuggestions(cl);

  log.section('plan');
  log.kv('last', suggestions.last ?? '(none)', suggestions.last ? undefined : 'first release');
  for (const kind of orderedKinds(suggestions)) {
    const candidate = suggestions.candidates[kind];
    if (!candidate) continue;
    log.kv(kind, candidate, kind === suggestions.defaultKind ? '← default' : undefined);
  }

  const nextVersion = await resolveNextVersion(inputs, suggestions, prompt);
  const tagName = applyPrefix(nextVersion, tagPrefix);
  const fromRef = await resolveFromRef(suggestions.last, tagPrefix, git);
  const branch = await git.currentBranch();
  const defaultBranch = await git.defaultBranch();
  const mode: ReleaseMode = inputs.mergeRequest ? 'merge-request' : 'standard';
  const releaseBranch = mode === 'merge-request' ? `release/${tagName}` : null;
  const mrUrl =
    mode === 'merge-request' ? mergeRequestUrl(host, releaseBranch!, defaultBranch) : null;

  log.kv('tag fmt', tagName, prefixNote(inputs.tagPrefixOverride, tagPrefix, tags));

  const newChangelog = serialize(
    transformChangelog(cl, {
      version: nextVersion,
      date: inputs.today,
      unreleasedUrl: compareUrl(host, tagName, defaultBranch),
      versionUrl: compareUrl(host, fromRef, tagName),
    }),
  );

  return {
    changelogPath: inputs.changelogPath,
    branch,
    nextVersion,
    tagName,
    commitMessage: `v${nextVersion}`,
    date: inputs.today,
    entries: [...cl.unreleased.body],
    newChangelog,
    host,
    push: inputs.push,
    // In merge-request mode the release commit isn't on the protected branch
    // yet, so tagging is deferred to the post-merge `--tag-release` step.
    tag: mode === 'merge-request' ? false : inputs.tag,
    mode,
    releaseBranch,
    mrUrl,
  };
}

function pickHost(cl: Changelog): HostInfo {
  const lines = [
    ...cl.header,
    ...(cl.unreleased?.body ?? []),
    ...cl.releases.flatMap((r) => [`## [${r.version}]`, ...r.body]),
    ...cl.links.map((l) => `[${l.name}]: ${l.url}`),
  ];
  const host = detectHost(lines);
  if (!host) {
    throw new PubvError(
      'no-host',
      'no forge URL (github / gitlab / bitbucket / *git*) found in CHANGELOG.md',
    );
  }
  return host;
}

interface VersionSuggestions {
  last: string | null;
  lastSemver: SemVer | null;
  defaultKind: BumpKind;
  defaultVersion: string;
  candidates: Partial<Record<BumpKind, string>>;
}

function computeSuggestions(cl: Changelog): VersionSuggestions {
  const last = latestRelease(cl);
  const lastSemver = last ? parseSemver(last.version) : null;

  const candidates: Partial<Record<BumpKind, string>> = {};
  if (lastSemver) {
    candidates.major = formatSemver(bump(lastSemver, 'major'));
    candidates.minor = formatSemver(bump(lastSemver, 'minor'));
    candidates.patch = formatSemver(bump(lastSemver, 'patch'));
    if (lastSemver.prerelease) {
      candidates.prerelease = formatSemver(bump(lastSemver, 'prerelease'));
    }
  }

  const unreleasedText = cl.unreleased?.body.join('\n') ?? '';
  const heuristic = suggestDefault(unreleasedText);
  const defaultKind: BumpKind =
    lastSemver?.prerelease && candidates.prerelease ? 'prerelease' : heuristic;

  const defaultVersion = lastSemver ? candidates[defaultKind]! : '0.1.0';

  return {
    last: last?.version ?? null,
    lastSemver,
    defaultKind,
    defaultVersion,
    candidates,
  };
}

function orderedKinds(s: VersionSuggestions): BumpKind[] {
  const order: BumpKind[] = ['major', 'minor', 'patch', 'prerelease'];
  return order.filter((k) => s.candidates[k] !== undefined);
}

async function resolveTagPrefix(
  inputs: ReleaseInputs,
  tags: readonly string[],
  prompt: Prompt,
): Promise<TagPrefix> {
  if (inputs.tagPrefixOverride !== null) return inputs.tagPrefixOverride;
  const detection = detectPrefix(tags);
  if (detection === 'v' || detection === '') return detection;
  if (inputs.yes) return 'v';
  return await prompt.select<TagPrefix>(
    detection === 'none'
      ? 'no existing tags. tag prefix?'
      : 'mixed prefixed/bare tags. which to use?',
    [
      { key: 'v', label: 'v1.2.3' },
      { key: '', label: '1.2.3 (no prefix)' },
    ],
    'v',
  );
}

function prefixNote(
  override: TagPrefix | null,
  resolved: TagPrefix,
  tags: readonly string[],
): string | undefined {
  if (override !== null) return 'from --tag-prefix';
  const detection = detectPrefix(tags);
  if (detection === resolved) return 'matches existing tags';
  if (detection === 'none') return 'default (no existing tags)';
  return undefined;
}

async function resolveNextVersion(
  inputs: ReleaseInputs,
  s: VersionSuggestions,
  prompt: Prompt,
): Promise<string> {
  const raw = inputs.versionArg ?? (inputs.yes ? s.defaultVersion : await askForVersion(prompt, s));
  const expanded = expandShorthand(raw.trim() || s.defaultVersion, s.candidates) ?? raw.trim();
  if (!isValidVersionString(expanded)) {
    throw new PubvError('invalid-version', `not a valid x.y.z[-tag] version: ${expanded}`);
  }
  return expanded;
}

async function askForVersion(prompt: Prompt, s: VersionSuggestions): Promise<string> {
  const tail =
    s.lastSemver === null
      ? 'x.y.z[-tag]'
      : `major/minor/patch${s.candidates.prerelease ? '/pre' : ''} or x.y.z[-tag]`;
  return await prompt.input(`version? (${tail})`, s.defaultVersion);
}

function expandShorthand(
  input: string,
  candidates: Partial<Record<BumpKind, string>>,
): string | null {
  const lower = input.toLowerCase();
  if (lower === 'major' || lower === 'ma') return candidates.major ?? null;
  if (lower === 'minor' || lower === 'mi') return candidates.minor ?? null;
  if (lower === 'patch' || lower === 'p') return candidates.patch ?? null;
  if (lower === 'prerelease' || lower === 'pre') return candidates.prerelease ?? null;
  return null;
}

async function resolveFromRef(
  lastVersion: string | null,
  prefix: TagPrefix,
  git: Git,
): Promise<string> {
  if (lastVersion) return applyPrefix(lastVersion, prefix);
  return await git.firstCommit();
}

// ─── confirm + apply ──────────────────────────────────────────────────────

function printPlan(plan: ReleasePlan, log: Logger): void {
  log.kv('commit', plan.commitMessage);
  log.kv('date', plan.date);
  if (plan.mode === 'merge-request' && plan.releaseBranch) {
    log.kv('branch', plan.releaseBranch, `merge request into ${plan.branch}`);
  } else {
    log.kv('branch', plan.branch);
  }

  log.section('changes');
  if (plan.entries.length === 0) {
    log.warn(`no entries under [Unreleased] — ${plan.tagName} would be empty`);
  } else {
    for (const entry of plan.entries) log.line(entry);
  }
}

async function confirm(ports: Ports, plan: ReleasePlan): Promise<boolean> {
  ports.log.section('confirm');
  const actions: string[] = [`write ${plan.changelogPath}`];
  if (plan.mode === 'merge-request' && plan.releaseBranch) {
    actions.push(
      `branch ${plan.releaseBranch}`,
      `commit ${plan.commitMessage}`,
      'push branch',
      'open merge request',
    );
  } else {
    actions.push(`commit ${plan.commitMessage}`);
    if (plan.tag) actions.push(`tag ${plan.tagName}`);
    if (plan.push) actions.push('push origin (with --follow-tags)');
  }
  ports.log.info(actions.join(' → '));
  return await ports.prompt.confirm('proceed?', true);
}

async function applyPlan(plan: ReleasePlan, inputs: ReleaseInputs, ports: Ports): Promise<void> {
  if (plan.mode === 'merge-request') {
    await applyMergeRequest(plan, inputs, ports);
    return;
  }

  const { fs, git, log } = ports;
  log.section('release');

  await fs.write(plan.changelogPath, plan.newChangelog);
  log.ok(`updated ${plan.changelogPath}`);

  await git.stage(plan.changelogPath);
  await git.commit(plan.commitMessage);
  log.ok(`committed ${plan.commitMessage}`);

  if (plan.tag) {
    await git.tag(plan.tagName, plan.commitMessage);
    log.ok(`tagged ${plan.tagName}`);
  }

  if (plan.push) {
    const spinner = log.spinner(`pushing to ${inputs.remote}`);
    try {
      await git.push(inputs.remote, plan.branch, { followTags: plan.tag });
      spinner.succeed(`pushed to ${inputs.remote}`);
    } catch (err) {
      spinner.fail('push failed');
      throw err;
    }
  }
}

async function applyMergeRequest(
  plan: ReleasePlan,
  inputs: ReleaseInputs,
  ports: Ports,
): Promise<void> {
  const { fs, git, log } = ports;
  const releaseBranch = plan.releaseBranch!;
  log.section('release');

  await git.createBranch(releaseBranch);
  log.ok(`branched ${releaseBranch}`);

  await fs.write(plan.changelogPath, plan.newChangelog);
  log.ok(`updated ${plan.changelogPath}`);

  await git.stage(plan.changelogPath);
  await git.commit(plan.commitMessage);
  log.ok(`committed ${plan.commitMessage}`);

  const spinner = log.spinner(`pushing ${releaseBranch} to ${inputs.remote}`);
  try {
    await git.push(inputs.remote, releaseBranch, { followTags: false, setUpstream: true });
    spinner.succeed(`pushed ${releaseBranch} to ${inputs.remote}`);
  } catch (err) {
    spinner.fail('push failed');
    throw err;
  }

  // Return to the original branch so the protected branch's local tree stays
  // clean — the changelog change comes back when the merge request is merged.
  await git.switchBranch(plan.branch);

  log.section('merge request');
  if (plan.mrUrl) log.kv('open', plan.mrUrl);
  log.info(`after merging, run \`pubv --tag-release\` on ${plan.branch} to tag ${plan.tagName}`);
}

// ─── tag-release (post-merge) ────────────────────────────────────────────────

async function runTagRelease(inputs: ReleaseInputs, ports: Ports): Promise<ReleasePlan> {
  const { fs, git, log, prompt } = ports;
  await preflight(inputs, ports);

  const cl = parse(await fs.read(inputs.changelogPath));
  const last = latestRelease(cl);
  if (!last) {
    throw new PubvError(
      'no-release',
      `${inputs.changelogPath} has no released version to tag — merge the release first`,
    );
  }

  const tags = await git.listTags();
  const tagPrefix = await resolveTagPrefix(inputs, tags, prompt);
  const tagName = applyPrefix(last.version, tagPrefix);
  const commitMessage = `v${last.version}`;

  if (tags.includes(tagName)) {
    throw new PubvError('tag-exists', `tag ${tagName} already exists`);
  }

  log.section('plan');
  log.kv('tag', tagName);
  log.kv('commit', commitMessage, 'on current HEAD');

  const plan: ReleasePlan = {
    changelogPath: inputs.changelogPath,
    branch: await git.currentBranch(),
    nextVersion: last.version,
    tagName,
    commitMessage,
    date: inputs.today,
    entries: [...last.body],
    newChangelog: serialize(cl),
    host: pickHost(cl),
    push: inputs.push,
    tag: true,
    mode: 'standard',
    releaseBranch: null,
    mrUrl: null,
  };

  if (inputs.dryRun) {
    log.section('dry-run');
    log.info(`would tag ${tagName} and push it to ${inputs.remote}.`);
    return plan;
  }

  if (!inputs.yes && !(await prompt.confirm(`tag ${tagName} and push it?`, true))) {
    throw new PubvError('user-aborted', 'aborted by user');
  }

  log.section('release');
  await git.tag(tagName, commitMessage);
  log.ok(`tagged ${tagName}`);

  if (inputs.push) {
    const spinner = log.spinner(`pushing ${tagName} to ${inputs.remote}`);
    try {
      await git.pushTag(inputs.remote, tagName);
      spinner.succeed(`pushed ${tagName} to ${inputs.remote}`);
    } catch (err) {
      spinner.fail('push failed');
      throw err;
    }
  }

  return plan;
}
