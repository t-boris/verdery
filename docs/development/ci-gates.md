# CI gates

Every pull request into `master` runs [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
This document maps each job to the command that reproduces it locally, and explains the decisions
that are not obvious from reading the YAML.

Source: [../architecture/testing-strategy.md](../architecture/testing-strategy.md), section
"22. CI Gates"; [../architecture/environments-and-delivery.md](../architecture/environments-and-delivery.md),
sections "7. Change Detection" and "17. Supply Chain".

## The jobs

| Job                      | Runs when                             | Reproduce locally                                                                               |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Detect affected surfaces | Always                                | —                                                                                               |
| Formatting and file size | Always                                | `pnpm format:check` and `pnpm check:file-size`                                                  |
| Lint, types, and tests   | TypeScript surfaces changed           | `pnpm build && pnpm lint && pnpm typecheck && pnpm test`                                        |
| API contract             | `packages/api-contracts` changed      | `pnpm --filter @verdery/api-contracts lint:contract` and `… generate:check`                     |
| Secret scan              | Always                                | —                                                                                               |
| Swift package            | `apps/ios` or shared fixtures changed | `cd apps/ios && swift build && swift test && xcodegen generate && bash scripts/run-ui-tests.sh` |
| Browser journeys         | Always                                | `bash apps/web/e2e/run-e2e.sh`                                                                  |
| All gates                | Always                                | —                                                                                               |

`pnpm check:all` covers the first three rows in one command, minus the `pnpm build` that CI needs on
a fresh checkout. The contract gates are not part of `check:all` and must be run separately.

## Gates without change detection

**Formatting and file size** apply to the whole repository, not to a surface. Prettier formats
Markdown as well as TypeScript, and the 600-line rule from [AGENTS.md](../../AGENTS.md) covers source
code, including Swift, while explicitly excluding documentation and other text-only files. A
change to any path may still violate formatting; code changes may also violate file size.

**The secret scan** is not scoped either, because a credential can be committed in any file, in any
directory, in any language.

The browser journey gate also runs on every PR and master push. It uses an isolated local API,
PostGIS, Auth emulator, and web server with no real credentials. See the
[reproduction instructions](reproducible-verification.md).

The TypeScript, contract, and Swift gates are scoped, and the filters are deliberately over-inclusive: each one also
matches the workspace manifests, the lockfile, and the workflow file itself, because any of those
can change the gate's outcome. A gate that runs unnecessarily costs runner minutes; a gate that is
skipped when it was affected lets a defect merge.

## Why the Swift job is separate

The Swift package can only be built with the Apple toolchain, which exists only on a macOS runner,
and macOS runners are billed at a large multiple of the Linux rate. It is the one job worth keeping
off most pull requests, which is why its filter is the narrowest — `apps/ios/**` plus
`packages/test-fixtures/fixtures/**`, because the Swift suite reads those fixtures.

The job also generates the app project, builds the Release iOS app, and executes the native
first-garden UI test on a fresh simulator. Its filter remains `apps/ios/**`,
`packages/test-fixtures/fixtures/**`, and `.github/workflows/ci.yml`. UI-test failure is a job failure;
the simulator runner preserves xcresult evidence on failure.

The job selects Xcode 26.6 explicitly rather than accepting the runner image default, since
[ADR-0009](../architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md) pins the iOS 26
SDK and Swift 6.3.

## Why CI builds before it type-checks

Workspace packages are consumed through their compiled `dist/`, which is not committed. On a fresh
CI checkout nothing resolves `@verdery/geometry-contracts` or `@verdery/api-contracts` until
`pnpm build` has run. Locally this step is usually invisible because `dist/` already exists from a
previous build.

## Why the contract job runs before anything builds

`pnpm --filter @verdery/api-contracts build` runs `generate` as its first step, which rewrites the
generated client. If the drift check ran after a build, it would compare a freshly regenerated file
against itself and always pass. The contract job therefore runs `generate:check` against the raw
checkout, in a job of its own. See [api-contract.md](api-contract.md).

## Why every action is pinned to a commit SHA

A tag is a mutable pointer. Whoever controls the action's repository can move `v4` to different code
at any time, and that code runs with access to the workflow's token and checkout. A 40-character
commit SHA cannot be moved.

Each pinned line carries the human-readable version as a trailing comment, because a bare SHA tells
a reviewer nothing about how far behind the pin is. `.github/dependabot.yml` proposes the updates,
which is what keeps SHA pinning from turning into permanent staleness.

Source: [../architecture/environments-and-delivery.md](../architecture/environments-and-delivery.md),
section "17. Supply Chain", "Pin GitHub Actions to trusted versions or commit SHAs according to
policy".

## Why permissions are empty at the top of the file

The workflow declares `permissions: {}` and each job re-grants only what it needs — `contents: read`
almost everywhere, plus `pull-requests: read` for the change-detection job. No job needs write
access, because this workflow validates and never publishes. Declaring the deny at the top means a
new job added later starts with nothing rather than inheriting the repository default.

## The "All gates" job

Change detection and required status checks conflict: a skipped job never reports a result, so
branch protection that requires it blocks every pull request that legitimately skipped it. The
aggregating `All gates` job resolves this. It depends on every gate, runs with `if: always()`, and
fails only when a dependency failed or was cancelled — a skipped gate is a correct outcome.

**Configure branch protection to require `All gates` and nothing else.**

Current repository state, verified October 4, 2026: `master` requires `All gates` from GitHub
Actions (app 15368), requires an up-to-date branch, and enforces the rule for administrators.
Force pushes and branch deletion are disabled. This supersedes the unprotected July 27 and
September 25 observations. See the [dated R02 evidence](../features/r02-reproducible-verification/implementation/verification.md)
for execution and merge-blocking evidence. The first hosted native UI test passed;
a red required All gates check blocked PR #31. Final complete browser acceptance
awaits the recorded Q-004 scope conflict.

## Reproducing a failure locally

```bash
pnpm install --frozen-lockfile   # the same install CI performs
pnpm build
pnpm check:all
pnpm --filter @verdery/api-contracts lint:contract
pnpm --filter @verdery/api-contracts generate:check
```

If a gate passes locally and fails in CI, check the Node.js version first. CI runs Node.js 24 from
`.nvmrc`; a local Node.js 22 prints an unsupported-engine warning on every command and is the most
likely explanation. See [local-setup.md](local-setup.md).

Tests that need PostgreSQL start it through Testcontainers, on the Docker daemon that the Ubuntu
runner provides. Locally the same tests need a running Docker daemon.

## Gates the architecture requires that do not exist yet

| Required gate                           | Status                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provisioning-script validation          | `infrastructure/gcloud/scripts/` is authoritative, but CI has no dedicated shell/static/idempotency gate                                          |
| Container vulnerability scan            | Images build and publish to Artifact Registry, but no blocking image scan is configured                                                           |
| End-to-end tests for release candidates | The complete local-stack browser suite is wired into All gates; higher-environment release-candidate and real-device iOS evidence remain separate |
| Dependency vulnerability scan           | Dependabot proposes updates; no blocking audit gate is configured                                                                                 |
| Documentation link checking             | Formatting is gated; nothing yet verifies that links resolve                                                                                      |

The first three are follow-up quality work rather than missing infrastructure — see
[deferred-capabilities.md](deferred-capabilities.md). The fourth is a deliberate choice: a blocking
`pnpm audit` fails pull requests for advisories published after the branch was cut, in code the
author did not touch, so updates are proposed rather than enforced until there is a triage owner.
