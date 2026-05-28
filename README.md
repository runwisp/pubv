# pubv — one-command changelog releases

[![npm version](https://img.shields.io/npm/v/pubv.svg)](https://www.npmjs.com/package/pubv)
[![npm downloads](https://img.shields.io/npm/dm/pubv.svg)](https://www.npmjs.com/package/pubv)
[![license](https://img.shields.io/npm/l/pubv.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/pubv.svg)](https://nodejs.org)

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
bunx pubv          # or:  npx pubv

# global
bun add -g pubv    # or:  npm install -g pubv
```

Requires Node 20+ (or Bun).

## Quick start

```bash
pubv               # interactive
pubv 1.3.0         # explicit version
pubv minor         # shorthand: bump minor based on last release
pubv --dry-run     # print the plan; don't change anything
pubv --yes 1.3.0   # CI mode: no prompts, exit non-zero on any issue
```

## What it does

1. **Preflight** — verifies `CHANGELOG.md` exists, you're on the default branch, the tree is clean, and `origin` is reachable and not ahead of you.
2. **Plan** — parses `CHANGELOG.md`, finds your last released version, suggests a default bump based on what's in `[Unreleased]` (see *Heuristic*), and detects the tag prefix (`v1.2.3` vs `1.2.3`) from your existing tags.
3. **Rewrite** — moves the `[Unreleased]` body into a new `## [<version>] - <date>` section, and rewrites the trailing `[Unreleased]` / `[<version>]` link refs with compare-URLs for your forge (GitHub / GitLab / Bitbucket auto-detected).
4. **Commit + tag + push** — `git commit -m v<version>`, `git tag -a <prefix><version>`, `git push --follow-tags origin <branch>`.

If anything fails or you say no at any prompt, `CHANGELOG.md` is left untouched.

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

  --dry-run           Show the plan; don't change anything.
  -y, --yes           Skip all confirmations (suitable for CI).
  --no-push           Don't push to the remote.
  --no-tag            Don't create a tag.
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
