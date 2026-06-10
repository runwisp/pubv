# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `--release` creates a GitHub/GitLab release after pushing the tag, using the graduated `[Unreleased]` entries as the notes. Shells out to `gh`/`glab`; a missing or unsupported CLI is warned and skipped without failing the run (the tag is already pushed).
- `--sign` produces a signed release commit and tag (`git commit -S` / `git tag -s`).
- `pubv` now auto-creates a `CHANGELOG.md` when none exists, folded into the existing confirmation flow, and cuts the first release (`0.1.0`) from it.
- `pubv init` scaffolds a fresh Keep a Changelog file (without releasing) for projects that want to start by hand.
- `--allow-empty` opt-in; otherwise graduating an empty `[Unreleased]` section is now refused instead of silently shipping an empty release.

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

[Unreleased]: https://github.com/runwisp/pubv/compare/v1.1.0...main
[1.1.0]: https://github.com/runwisp/pubv/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/runwisp/pubv/releases/tag/v1.0.0
