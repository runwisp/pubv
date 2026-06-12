# pubv — one-command changelog releases

[![npm version](https://img.shields.io/npm/v/@runwisp/pubv.svg)](https://www.npmjs.com/package/@runwisp/pubv)
[![license](https://img.shields.io/npm/l/@runwisp/pubv.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@runwisp/pubv.svg)](https://nodejs.org)

> **Automate releases from your `CHANGELOG.md`.** Graduate the `[Unreleased]` block into a real release — bump the version, rewrite the changelog, commit, tag, and push — with one command.

`pubv` is a tiny, zero-config **release automation CLI** for projects that keep a [Keep a Changelog](https://keepachangelog.com/)-style `CHANGELOG.md`. It picks a sensible **semver** bump from your unreleased notes, then commits, **git-tags**, and pushes the release for you — on **GitHub**, **GitLab**, or **Bitbucket**. No config files, one runtime dependency.

```
  pubv  v1.0.0

  ── preflight ─────────────────────────────
  ✓ on main
  ✓ working tree clean
  ✓ origin up-to-date

  ── plan ──────────────────────────────────
  last     1.2.0
  major    2.0.0
  minor    1.3.0  ← default
  patch    1.2.1
  tag fmt  v1.3.0  matches existing tags

  version? [1.3.0] › _
```

Under the hood: it reads `CHANGELOG.md`, figures out a sensible default for the next version, rewrites the changelog, commits, tags, and pushes — with a single push using `--follow-tags`.

## Install

```bash
# one-shot
bunx @runwisp/pubv          # or:  npx @runwisp/pubv

# global (recommended — puts `pubv` on your PATH)
bun add -g @runwisp/pubv    # or:  npm install -g @runwisp/pubv
```

Requires Node 20+ (or Bun).

## Quick start

```bash
pubv               # interactive
pubv 1.3.0         # explicit version
pubv minor         # shorthand: bump minor based on last release
pubv --dry-run     # print the plan; don't change anything
pubv --yes 1.3.0   # CI mode: no prompts, exit non-zero on any issue
pubv --release     # also create a GitHub/GitLab release (via gh/glab)
pubv init          # scaffold a CHANGELOG.md and stop
```

No `CHANGELOG.md` yet? Just run `pubv` — it offers to create one (canonical
Keep a Changelog header) as part of the normal confirmation and cuts your first
release from it. Prefer to write the changelog by hand first? `pubv init`
scaffolds the file without releasing.

## What it does

1. **Preflight** — verifies `CHANGELOG.md` exists, you're on the default branch, the tree is clean, and `origin` is reachable and not ahead of you.
2. **Plan** — parses `CHANGELOG.md`, finds your last released version, suggests a default bump based on what's in `[Unreleased]` (see *Heuristic*), and detects the tag prefix (`v1.2.3` vs `1.2.3`) from your existing tags.
3. **Rewrite** — moves the `[Unreleased]` body into a new `## [<version>] - <date>` section, and rewrites the trailing `[Unreleased]` / `[<version>]` link refs with compare-URLs for your forge (GitHub / GitLab / Bitbucket auto-detected).
4. **Commit + tag + push** — `git commit -m v<version>`, `git tag -a <prefix><version>`, `git push --follow-tags origin <branch>`.

If anything fails or you say no at any prompt, `CHANGELOG.md` is left untouched.

## Create a forge release

`pubv --release` goes one step past the tag: after pushing, it opens a
**GitHub/GitLab release** with the freshly-graduated `[Unreleased]` entries as
the notes. It shells out to the forge CLI you already have — [`gh`] for GitHub,
[`glab`] for GitLab — exactly as it shells out to `git`. No extra dependency, no
token plumbing in `pubv` itself (the CLI handles auth).

If the CLI isn't installed, isn't authenticated, or the host has no release CLI
(Bitbucket), `pubv` warns and moves on — the tag is already pushed, so a missing
release page never fails the run.

[`gh`]: https://cli.github.com/
[`glab`]: https://gitlab.com/gitlab-org/cli

## Signing

`pubv --sign` signs the release commit and tag (`git commit -S` / `git tag -s`),
for repos or orgs that require GPG-signed releases. It uses your existing git
signing configuration.

## Heuristic for the default bump

`pubv` inspects the `[Unreleased]` section:

| Trigger in `[Unreleased]` body | Default bump |
|---|---|
| `BC`, `BREAKING CHANGE`, or `Breaking` (capitalized) | **major** |
| `Added` or `Changed` | **minor** |
| otherwise (incl. only `Fixed` / `Security` / `Removed`) | **patch** |

You can always override on the prompt or via `pubv major | minor | patch | pre | 1.2.3`.

> `Removed` alone doesn't force major — many changelogs use it for deprecations and dead-code removal that aren't breaking. Mark genuinely-breaking entries with `**BC**:` or `BREAKING CHANGE:`.

## Flags

```
pubv [version] [flags]
pubv init             Scaffold a new CHANGELOG.md and exit.

  --dry-run           Show the plan; don't change anything.
  -y, --yes           Skip all confirmations (suitable for CI).
  --no-push           Don't push to the remote.
  --no-tag            Don't create a tag.
  --sign              Sign the release commit and tag (git commit -S / tag -s).
  --release           Create a forge release via gh/glab after pushing the tag.
  --allow-empty       Allow graduating an empty [Unreleased] section.
  --merge-request,--mr Protected branch: commit on a release/<version> branch,
                      push it, and print a "create merge request" URL (no tag).
  --tag-release       Post-merge step: tag the latest changelog release on HEAD
                      and push the tag (pairs with --merge-request).
  --tag-prefix=v|none Override tag-prefix auto-detection.
  --changelog=PATH    Path to the changelog file (default: CHANGELOG.md).
  --remote=NAME       Remote name (default: origin).
  --date=YYYY-MM-DD   Override today's date in the new heading.
  -h, --help          Show this help.
  -v, --version       Print pubv's version.
```

`pubv` respects `NO_COLOR` and `CI` (no spinners, no ANSI colors).

## Protected branches (merge-request workflow)

If your default branch is protected and only accepts changes via merge/pull
requests, you can't push the release commit directly. `pubv` splits the release
into two steps:

```bash
pubv --merge-request   # off the default branch:
                       #   creates release/<version>, commits the changelog there,
                       #   pushes the branch, and prints a ready-to-open MR URL.
                       #   No tag is created yet — your local default stays clean.

# … review and merge the MR. Then, on the updated default branch:
git switch main && git pull

pubv --tag-release     # reads the latest released version from CHANGELOG.md and
                       #   tags the real merge commit, then pushes just the tag.
```

The tag is deferred to `--tag-release` on purpose: until the MR is merged the
release commit isn't on the protected branch, and a squash/rebase merge would
leave a tag pointing at a commit that never lands there. `--tag-release` tags
`HEAD` of the merged default branch so the tag is always correct.

## Forge detection (self-hosted & custom domains)

`pubv` needs to know which forge you're on to write correct compare / merge-request
URLs and to run the protected-branch check. It figures this out in order:

1. **The git remote is the source of truth.** `pubv` reads `git remote get-url <remote>`
   (handles `https`, `ssh://`, and `git@host:group/sub/proj.git` forms) for the real
   host and project path — subgroups and custom ports included.
2. **Host name first.** `github.com`, `*gitlab*`, and `*bitbucket*` are recognised
   instantly, with no network call.
3. **HTTP fingerprint for unknown domains.** A self-hosted GitLab on a custom domain
   (`code.acme.com`, `vcs.corp.io`, …) can't be recognised by name, so `pubv` fetches
   its pre-login PWA manifest (`GET /-/manifest.json`) and checks for GitLab over HTTPS.
4. **CHANGELOG fallback.** With no usable remote, `pubv` scrapes the forge URL from
   your `CHANGELOG.md` link refs instead — for URL generation only. The
   protected-branch check is a preflight gate and runs only when the **origin
   remote** itself resolves to GitHub/GitLab; with no such remote it's skipped
   (there's nothing to push to) and the release proceeds in standard mode.

The probe is **best-effort and never blocks a release**: a host that's unreachable,
login-walled, or simply isn't a known forge falls back to a generic classification
(GitHub-style URLs, protected-branch check skipped). It only runs for genuinely
unknown custom domains — the common GitHub/GitLab cases never touch the network.
Set `PUBV_NO_HOST_PROBE=1` to disable the probe entirely (mirrors
`PUBV_NO_PROTECTION_CHECK`).

## Design

Code layout:

```
src/
  core/      pure logic — parse, transform, bump, host, prefix, orchestrator
  ports/     narrow TS interfaces for git, fs, prompt, logger
  adapters/  the only files that touch node:fs / node:child_process / node:readline
  cli/       hand-rolled arg parser + help + composition root
  bin.ts     entry point
```

Tests:

- **Unit** — every core module has its own test file. Changelog transforms are driven by **plain `.md`/`.json` fixtures** in `tests/fixtures/` — input + expected output + metadata. Adding a new scenario is a new folder, no test code change.
- **E2E** — `tests/e2e/publish.test.ts` spawns the built CLI inside a temp git repo against a local bare remote, verifying the full path including the push.

## How it compares

`pubv` deliberately does one thing: turn a Keep a Changelog `CHANGELOG.md` into a tagged, pushed release. If you were looking at heavier release tools — `standard-version`, `release-it`, `semantic-release`, `changesets`, `np`, or `commit-and-tag-version` — and wanted something smaller that trusts the changelog *you* already write (no commit-message conventions, no config file, one dependency), that's the gap `pubv` fills.

## Contributing

```bash
bun install
bun run lint
bun run typecheck
bun test          # fast: ~50 unit tests + 7 e2e
bun run build
```

## License

[MIT](./LICENSE)
