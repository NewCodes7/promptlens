# Changelog

Notable changes to PromptLens. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Breaking:** Node.js 22 or later is required. Node.js 20 reached end-of-life in April 2026. CI now tests Node.js 22, 24 and 26, and the workflow that `init` generates runs on Node.js 24.
- An unknown command prints an error, with the closest command when there is one, and exits with code 1. It used to print the usage and exit 0, so a mistyped command looked like success to scripts and agents. `promptlens`, `help`, `--help` and `-h` print the usage.
- External JSON (Claude Code session logs, LLM responses, GitHub events, notes pushed by others) is read as `unknown` and narrowed, so a wrong shape falls back to a default instead of crashing.
- Error messages read thrown values that are not `Error` objects instead of printing `undefined`.
- Tests run on Vitest 5.

### Documentation

- The README explains where PromptLens came from, how it runs, and how the design was reached.
- Added this changelog.

## [0.2.0] - 2026-11-10

First release on npm, as `@newcodes/promptlens`.

### Added

- `promptlens init` installs `post-commit` and `pre-push` hooks, notes rewrite and fetch config, and a PR workflow pinned to the installed version.
- `capture` links Claude Code sessions to each commit: a session counts when it edited a file the commit changed, through Edit/Write tools or shell writes.
- `summarize` writes a Commit Context to `refs/notes/promptlens` in the background, using `claude -p`, then OpenAI, then a heuristic. `sync` fills in missing notes and pushes them from `pre-push`.
- `pr-report --post` keeps one comment on the PR with a prompt-by-prompt flow chart, and commits a line-commentable review file, `.promptlens/PR-<n>.md`.
- `show`, `report` and `report --file` preview the output locally.
- Developer prompts are quoted verbatim, and translated with a label when they are not in English.
- Secrets and email addresses are redacted before anything leaves the machine.
- Biome lint and format, type-checked tests, and CI that runs lint, typecheck, tests with coverage, the build, a CLI smoke test and `npm pack --dry-run`.

[Unreleased]: https://github.com/NewCodes7/promptlens/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/NewCodes7/promptlens/releases/tag/v0.2.0
