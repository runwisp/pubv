import type { Forge } from '../ports/forge.js';
import type { Fs } from '../ports/fs.js';
import type { Git } from '../ports/git.js';
import type { HostProber } from '../ports/host-prober.js';
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
import {
  type HostInfo,
  classifyHost,
  compareUrl,
  detectHost,
  mergeRequestUrl,
  parseRemoteUrl,
} from './host.js';
import { buildScaffold } from './init.js';
import { type TagPrefix, applyPrefix, detectPrefix, splitPrefix } from './tag-prefix.js';
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
  /** Sign the release commit and tag. */
  sign: boolean;
  /** Create a forge release (via `gh` / `glab`) after pushing the tag. */
  release: boolean;
  /** Allow graduating an empty `[Unreleased]` section. */
  allowEmpty: boolean;
  /** Allow releasing from a non-default branch (required with -y). */
  allowBranch: boolean;
  /** Open a release branch + merge request instead of pushing the default branch. */
  mergeRequest: boolean;
  /** Tag the latest changelog release on HEAD and push the tag (post-merge step). */
  tagRelease: boolean;
  /** Skip the forge protected-branch check and push directly (escape hatch). */
  skipProtectionCheck: boolean;
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
  /** True when the changelog did not exist and is being scaffolded this run. */
  createChangelog: boolean;
}

export interface Ports {
  git: Git;
  fs: Fs;
  prompt: Prompt;
  log: Logger;
  forge: Forge;
  hostProber: HostProber;
}

export async function run(inputs: ReleaseInputs, ports: Ports): Promise<ReleasePlan> {
  if (inputs.tagRelease) return runTagRelease(inputs, ports);

  const scaffold = await preflight(inputs, ports);
  const plan = await buildPlan(inputs, ports, scaffold);
  printPlan(plan, ports.log);

  if (inputs.dryRun) {
    ports.log.section('dry-run');
    ports.log.info('no files written, no commits, no pushes.');
    return plan;
  }

  if (!inputs.yes && !(await confirm(ports, plan, inputs))) {
    throw new PubvError('user-aborted', 'aborted by user');
  }

  await applyPlan(plan, inputs, ports);
  return plan;
}

// ─── preflight ─────────────────────────────────────────────────────────────

async function preflight(inputs: ReleaseInputs, ports: Ports): Promise<boolean> {
  const { fs, git, log, prompt } = ports;

  const scaffold = !(await fs.exists(inputs.changelogPath));

  log.section('preflight');

  if (scaffold) {
    log.warn(`${inputs.changelogPath} not found — a new one will be created`);
  }

  const defaultBranch = await git.defaultBranch();
  const currentBranch = await git.currentBranch();

  if (currentBranch === defaultBranch) {
    log.ok(`on ${currentBranch}`);
  } else if (inputs.allowBranch) {
    log.warn(`releasing from ${currentBranch} (not ${defaultBranch}) — allowed via --allow-branch`);
  } else if (inputs.yes) {
    throw new PubvError(
      'wrong-branch',
      `not on ${defaultBranch} (on ${currentBranch}) — pass --allow-branch to release from a non-default branch`,
    );
  } else {
    log.warn(`current branch is ${currentBranch}, expected ${defaultBranch}`);
    if (!(await prompt.confirm('continue from this branch?', false))) {
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

  return scaffold;
}

// ─── plan ──────────────────────────────────────────────────────────────────

async function buildPlan(
  inputs: ReleaseInputs,
  ports: Ports,
  scaffold: boolean,
): Promise<ReleasePlan> {
  const { fs, git, log, prompt } = ports;

  const source = scaffold
    ? buildScaffold({ repoUrl: await git.remoteUrl(inputs.remote) })
    : await fs.read(inputs.changelogPath);
  const cl = parse(source);
  if (!cl.unreleased) {
    throw new PubvError(
      'no-unreleased',
      `${inputs.changelogPath} has no [Unreleased] section to graduate`,
    );
  }

  // A fresh scaffold always graduates an empty [Unreleased] (the bootstrap
  // first release); only an existing changelog is held to the empty-guard.
  const hasEntries = cl.unreleased.body.some((line) => line.trim() !== '');
  if (!hasEntries && !inputs.allowEmpty && !scaffold) {
    throw new PubvError(
      'empty-release',
      `${inputs.changelogPath} has no entries under [Unreleased] — add entries or pass --allow-empty`,
    );
  }

  printChanges(cl.unreleased.body, log);

  const host = await resolveHost(cl, inputs, ports);
  const tags = await git.listTags();
  const suggestions = computeSuggestions(cl);

  log.section('plan');
  log.kv('last', suggestions.last ?? '(none)', suggestions.last ? undefined : 'first release');
  for (const kind of orderedKinds(suggestions)) {
    const candidate = suggestions.candidates[kind];
    if (!candidate) continue;
    log.kv(kind, candidate, kind === suggestions.defaultKind ? '← default' : undefined);
  }

  // Resolve the version first: a literal version arg may carry its own prefix
  // (e.g. `myapp.1.2.3`), which takes precedence over tag auto-detection.
  const { version: nextVersion, embeddedPrefix } = await resolveNextVersion(
    inputs,
    suggestions,
    prompt,
  );
  const tagPrefix = await resolveTagPrefix(inputs, tags, embeddedPrefix, prompt);
  const tagName = applyPrefix(nextVersion, tagPrefix);
  const headingVersion = changelogVersion(nextVersion, tagPrefix);
  const fromRef = await resolveFromRef(suggestions.last, tagPrefix, git);
  const branch = await git.currentBranch();
  const defaultBranch = await git.defaultBranch();
  const mode = await resolveMode(inputs, ports, host, branch, defaultBranch);
  const releaseBranch = mode === 'merge-request' ? `release/${tagName}` : null;
  const mrUrl =
    mode === 'merge-request' ? mergeRequestUrl(host, releaseBranch!, defaultBranch) : null;

  log.kv('tag fmt', tagName, prefixNote(inputs.tagPrefixOverride, embeddedPrefix, tagPrefix, tags));

  const newChangelog = serialize(
    transformChangelog(cl, {
      version: headingVersion,
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
    commitMessage: tagName,
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
    createChangelog: scaffold,
  };
}

/**
 * Decide whether to push directly or open a merge request. `--merge-request`
 * forces MR mode. Otherwise, when a direct push would land on the protected
 * default branch, we auto-switch to the MR flow so no commit/tag is made on a
 * branch the push would be rejected from. The check only runs for that exact
 * case (push enabled, on the default branch); anything undeterminable proceeds
 * with a direct push, since detection is advisory and must never block.
 */
async function resolveMode(
  inputs: ReleaseInputs,
  ports: Ports,
  host: HostInfo,
  branch: string,
  defaultBranch: string,
): Promise<ReleaseMode> {
  if (inputs.mergeRequest) return 'merge-request';
  if (inputs.skipProtectionCheck || !inputs.push || branch !== defaultBranch) {
    return 'standard';
  }

  const isProtected = await ports.forge.branchProtected(host, branch);
  if (isProtected === true) {
    ports.log.warn(`${branch} is protected on ${host.kind} — switching to merge-request workflow`);
    return 'merge-request';
  }
  if (isProtected === null) {
    ports.log.info(
      'branch protection undetermined (no gh/glab or unsupported host) — pushing directly',
    );
  }
  return 'standard';
}

/**
 * Resolve the forge host, authoritatively. The git remote is the source of
 * truth (it names the real host + project path); the CHANGELOG is only scraped
 * when no usable remote exists. A custom domain the name heuristic can't place
 * (`generic`) is refined by an HTTP fingerprint probe — best-effort, so a host
 * that can't be probed simply stays `generic` and never blocks the release.
 */
async function resolveHost(cl: Changelog, inputs: ReleaseInputs, ports: Ports): Promise<HostInfo> {
  const { git, hostProber } = ports;

  const remote = await git.remoteUrl(inputs.remote);
  const ref = remote ? parseRemoteUrl(remote) : null;
  if (ref) {
    let kind = classifyHost(ref.host);
    if (kind === 'generic') kind = (await hostProber.classify(ref.host)) ?? 'generic';
    return { kind, base: `https://${ref.host}/${ref.projectPath}` };
  }

  const host = detectHost(changelogLines(cl));
  if (!host) {
    throw new PubvError(
      'no-host',
      `no usable ${inputs.remote} remote and no forge URL (github / gitlab / bitbucket / *git*) found in ${inputs.changelogPath}`,
    );
  }
  if (host.kind === 'generic') {
    const probed = await hostProber.classify(new URL(host.base).host);
    if (probed) return { ...host, kind: probed };
  }
  return host;
}

function changelogLines(cl: Changelog): string[] {
  return [
    ...cl.header,
    ...(cl.unreleased?.body ?? []),
    ...cl.releases.flatMap((r) => [`## [${r.version}]`, ...r.body]),
    ...cl.links.map((l) => `[${l.name}]: ${l.url}`),
  ];
}

interface VersionSuggestions {
  last: string | null;
  lastSemver: SemVer | null;
  defaultKind: BumpKind;
  defaultVersion: string;
  candidates: Partial<Record<BumpKind, string>>;
}

/**
 * The version string written into CHANGELOG.md headings. Custom prefixes are
 * shown so headings match their tags (`## [myapp.1.2.3]`), but the conventional
 * `v` prefix and bare tags keep Keep-a-Changelog's bare headings (`## [1.2.3]`).
 */
function changelogVersion(version: string, prefix: TagPrefix): string {
  return prefix === '' || prefix === 'v' ? version : applyPrefix(version, prefix);
}

function computeSuggestions(cl: Changelog): VersionSuggestions {
  const last = latestRelease(cl);
  // Headings may carry a prefix (`myapp.1.2.3`); strip it before bumping.
  const lastSplit = last ? splitPrefix(last.version) : null;
  const lastSemver = lastSplit ? parseSemver(lastSplit.version) : null;

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
  embeddedPrefix: TagPrefix | null,
  prompt: Prompt,
): Promise<TagPrefix> {
  if (inputs.tagPrefixOverride !== null) return inputs.tagPrefixOverride;
  if (embeddedPrefix !== null) return embeddedPrefix;
  const detection = detectPrefix(tags);
  if (detection.kind === 'unique') return detection.prefix;
  if (inputs.yes) return 'v';
  return await prompt.select<TagPrefix>(
    detection.kind === 'none'
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
  embeddedPrefix: TagPrefix | null,
  resolved: TagPrefix,
  tags: readonly string[],
): string | undefined {
  if (override !== null) return 'from --tag-prefix';
  if (embeddedPrefix !== null) return 'from version arg';
  const detection = detectPrefix(tags);
  if (detection.kind === 'unique' && detection.prefix === resolved) return 'matches existing tags';
  if (detection.kind === 'none') return 'default (no existing tags)';
  return undefined;
}

interface ResolvedVersion {
  /** Bare semver, e.g. `1.2.3` or `1.0.0-rc.2`. */
  version: string;
  /** Prefix carried by a literal version arg (`myapp.` from `myapp.1.2.3`); `null` otherwise. */
  embeddedPrefix: TagPrefix | null;
}

async function resolveNextVersion(
  inputs: ReleaseInputs,
  s: VersionSuggestions,
  prompt: Prompt,
): Promise<ResolvedVersion> {
  const raw = inputs.versionArg ?? (inputs.yes ? s.defaultVersion : await askForVersion(prompt, s));
  const trimmed = raw.trim() || s.defaultVersion;

  const shorthand = expandShorthand(trimmed, s.candidates);
  if (shorthand) return { version: shorthand, embeddedPrefix: null };

  // A literal version may include a prefix (`myapp.1.2.3`); split it off and
  // treat the bare semver as the version. An empty prefix means a bare version
  // was typed, so fall back to tag detection rather than forcing "no prefix".
  const split = splitPrefix(trimmed);
  if (!split || !isValidVersionString(split.version)) {
    throw new PubvError('invalid-version', `not a valid [prefix]x.y.z[-tag] version: ${trimmed}`);
  }
  return { version: split.version, embeddedPrefix: split.prefix === '' ? null : split.prefix };
}

async function askForVersion(prompt: Prompt, s: VersionSuggestions): Promise<string> {
  const tail =
    s.lastSemver === null
      ? '[prefix]x.y.z[-tag]'
      : `major/minor/patch${s.candidates.prerelease ? '/pre' : ''} or [prefix]x.y.z[-tag]`;
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
  if (lastVersion) {
    // A heading that already carries a prefix (`myapp.1.0.0`) is the full tag
    // name; a bare heading needs the resolved prefix applied to reach the tag.
    const split = splitPrefix(lastVersion);
    if (split && split.prefix !== '') return lastVersion;
    return applyPrefix(lastVersion, prefix);
  }
  return await git.firstCommit();
}

// ─── confirm + apply ──────────────────────────────────────────────────────

function printChanges(entries: readonly string[], log: Logger): void {
  log.section('changes');
  if (entries.length === 0) {
    log.warn('no entries under [Unreleased] — this release would be empty');
  } else {
    for (const entry of entries) log.line(entry);
  }
}

function printPlan(plan: ReleasePlan, log: Logger): void {
  log.kv('commit', plan.commitMessage);
  log.kv('date', plan.date);
  if (plan.mode === 'merge-request' && plan.releaseBranch) {
    log.kv('branch', plan.releaseBranch, `merge request into ${plan.branch}`);
  } else {
    log.kv('branch', plan.branch);
  }
}

async function confirm(ports: Ports, plan: ReleasePlan, inputs: ReleaseInputs): Promise<boolean> {
  ports.log.section('confirm');
  const actions: string[] = [`${plan.createChangelog ? 'create' : 'write'} ${plan.changelogPath}`];
  if (plan.mode === 'merge-request' && plan.releaseBranch) {
    actions.push(
      `branch ${plan.releaseBranch}`,
      `commit ${plan.commitMessage}${inputs.sign ? ' (signed)' : ''}`,
      'push branch',
      'open merge request',
    );
  } else {
    actions.push(`commit ${plan.commitMessage}${inputs.sign ? ' (signed)' : ''}`);
    if (plan.tag) actions.push(`tag ${plan.tagName}${inputs.sign ? ' (signed)' : ''}`);
    if (plan.push) actions.push('push origin (with --follow-tags)');
    if (inputs.release && plan.tag && plan.push) actions.push(`create ${plan.host.kind} release`);
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
  await git.commit(plan.commitMessage, { sign: inputs.sign });
  log.ok(`committed ${plan.commitMessage}`);

  if (plan.tag) {
    await git.tag(plan.tagName, plan.commitMessage, { sign: inputs.sign });
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

  if (inputs.release && plan.tag && plan.push) {
    await createForgeRelease(plan, ports);
  }
}

// ─── forge release ───────────────────────────────────────────────────────────

/**
 * Best-effort: create a release page on the forge. The tag is already pushed by
 * the time this runs, so a missing CLI or a failed call only warns — it never
 * aborts the release.
 */
async function createForgeRelease(plan: ReleasePlan, ports: Ports): Promise<void> {
  const { forge, log } = ports;
  const spinner = log.spinner(`creating ${plan.host.kind} release`);
  const result = await forge.createRelease({
    host: plan.host,
    tag: plan.tagName,
    title: plan.tagName,
    notes: plan.entries.join('\n'),
  });
  if (result.created) {
    spinner.succeed(result.url ? `release created: ${result.url}` : 'release created');
  } else {
    spinner.stop();
    log.warn(`release not created (${result.reason ?? 'unknown'})`);
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
  await git.commit(plan.commitMessage, { sign: inputs.sign });
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
  // If the changelog heading already carries a prefix it is the full tag name;
  // otherwise resolve the prefix (detect / override / prompt) and apply it.
  const split = splitPrefix(last.version);
  const tagName =
    split && split.prefix !== ''
      ? last.version
      : applyPrefix(last.version, await resolveTagPrefix(inputs, tags, null, prompt));
  const commitMessage = tagName;

  if (tags.includes(tagName)) {
    throw new PubvError('tag-exists', `tag ${tagName} already exists`);
  }

  log.section('plan');
  log.kv('tag', tagName);
  log.kv('commit', commitMessage, 'on current HEAD');

  const host = await resolveHost(cl, inputs, ports);
  const plan: ReleasePlan = {
    changelogPath: inputs.changelogPath,
    branch: await git.currentBranch(),
    nextVersion: last.version,
    tagName,
    commitMessage,
    date: inputs.today,
    entries: [...last.body],
    newChangelog: serialize(cl),
    host,
    push: inputs.push,
    tag: true,
    mode: 'standard',
    releaseBranch: null,
    mrUrl: null,
    createChangelog: false,
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
  await git.tag(tagName, commitMessage, { sign: inputs.sign });
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

    if (inputs.release) await createForgeRelease(plan, ports);
  }

  return plan;
}

// ─── init (scaffold) ─────────────────────────────────────────────────────────

/**
 * Scaffold a fresh Keep a Changelog file and stop. Unlike the auto-scaffold
 * baked into `run`, this writes the empty template for the user to fill in —
 * no release is cut. Errors if the changelog already exists.
 */
export async function runInit(inputs: ReleaseInputs, ports: Ports): Promise<void> {
  const { fs, git, log } = ports;

  if (await fs.exists(inputs.changelogPath)) {
    throw new PubvError('changelog-exists', `${inputs.changelogPath} already exists`);
  }

  const repoUrl = await git.remoteUrl(inputs.remote);
  const content = buildScaffold({ repoUrl });

  log.section('init');
  if (inputs.dryRun) {
    log.info(`would create ${inputs.changelogPath}`);
    return;
  }

  await fs.write(inputs.changelogPath, content);
  log.ok(`created ${inputs.changelogPath}`);
  if (!repoUrl) {
    log.warn('no remote URL detected — add a forge URL before releasing');
  }
  log.info('next: add entries under [Unreleased], then run `pubv`');
}
