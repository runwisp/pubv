# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-06-12

### Added

- `--allow-branch` opt-in for releasing from a non-default branch. Interactive runs still prompt for confirmation, but `-y`/CI now refuses a non-default branch unless the flag is passed — so a release can't be cut from the wrong branch by mistake.

### Changed

- When the protected-branch check is skipped because `gh`/`glab` isn't installed, `pubv` now says so explicitly (`gh not found — skipping protected-branch check`) so you know the feature exists and how to enable it. Other undeterminable cases (auth, network, unsupported host) still push directly with a generic notice.

## [1.2.0] - 2026-06-10

### Added

- `--release` creates a GitHub/GitLab release after pushing the tag, using the graduated `[Unreleased]` entries as the notes. Shells out to `gh`/`glab`; a missing or unsupported CLI is warned and skipped without failing the run (the tag is already pushed).
- `--sign` produces a signed release commit and tag (`git commit -S` / `git tag -s`).
- `pubv` now auto-creates a `CHANGELOG.md` when none exists, folded into the existing confirmation flow, and cuts the first release (`0.1.0`) from it.
- `pubv init` scaffolds a fresh Keep a Changelog file (without releasing) for projects that want to start by hand.
- `--allow-empty` opt-in; otherwise graduating an empty `[Unreleased]` section is now refused instead of silently shipping an empty release.
- Self-hosted GitLab on a **custom domain** (e.g. `code.acme.com`, not just hosts named `*gitlab*`) is now detected reliably. The git remote (`git remote get-url`) is the authoritative source for the host and project path; when the host name gives no hint, `pubv` fingerprints it over HTTPS via GitLab's pre-login PWA manifest (`GET /-/manifest.json`). Compare/merge-request URLs and the protected-branch check are therefore correct on custom-domain GitLab, including subgroups. Detection is best-effort and never blocks a release: an unreachable, login-walled, or unknown host simply falls back to a generic classification. Set `PUBV_NO_HOST_PROBE=1` to skip the network probe.
- Protected default branches are now auto-detected via the `gh`/`glab` CLI before a direct release. When the branch you'd push is protected, `pubv` switches to the merge-request workflow instead of committing and tagging on a branch the push would be rejected from. Detection is best-effort: when it can't run (no CLI, unsupported host, network/auth failure) `pubv` pushes directly as before. Use `--no-protection-check` (or `PUBV_NO_PROTECTION_CHECK=1`) to skip the check.

### Fixed

- The protected-branch check (`gh`/`glab`) now preserves a non-standard port from the forge URL, so self-hosted instances served on a custom port are targeted correctly.

## [1.1.0] - 2026-06-08

### Added

- Support for arbitrary `PREFIX.x.y.z` tag/version formats (e.g. `myapp.1.2.3`, `app-1.2.3`). Prefixes are auto-detected from existing tags or can be typed directly at the version prompt; custom prefixes also appear in changelog headings.
- Prerelease suffixes are recognised and bumped intelligently (`1.0.0-RC5` → `1.0.0-RC6`, `1.2.1-beta`).

### Changed

- The changelog preview is now shown before the version prompt, so the entries can inform the version choice.

## [1.0.0] - 2026-05-28

### Added

- Initial TypeScript port of the internal `pubv` script.
- `--dry-run`, `--no-push`, `--no-tag`, `--yes` flags.
- Auto-detect tag prefix from existing tags (`v1.2.3` vs `1.2.3`).
- GitHub, GitLab, and Bitbucket compare-URL support.

[Unreleased]: https://github.com/runwisp/pubv/compare/v1.3.0...main
[1.3.0]: https://github.com/runwisp/pubv/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/runwisp/pubv/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/runwisp/pubv/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/runwisp/pubv/releases/tag/v1.0.0
