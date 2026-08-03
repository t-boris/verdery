# Verdery

Verdery is a cross-device product for people who maintain an outdoor garden, vegetable plot, yard,
orchard, greenhouse, or other planted space. It builds a progressively refined digital
representation of a real garden, records what grows there and where, tracks observations and work,
and explains what needs attention today.

> Verdery knows what grows where, considers current conditions and care history, and explains what
> the user should do in the garden today.

`Verdery` is the implementation name used by packages and services in this repository. The product
documentation under `docs/` still uses the earlier working name `Grow Garden`; the two refer to the
same product.

The authoritative sources are:

| Document                                                           | Authority                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| [docs/technical-specification.md](docs/technical-specification.md) | Product meaning, journeys, and scope                    |
| [docs/high-level-architecture.md](docs/high-level-architecture.md) | System boundaries                                       |
| [docs/architecture/](docs/architecture/)                           | Component design, failure behavior, completion criteria |
| [docs/architecture/decisions/](docs/architecture/decisions/)       | Accepted architecture decisions                         |
| [docs/implementation-plan.md](docs/implementation-plan.md)         | Delivery sequence and work packages                     |
| [AGENTS.md](AGENTS.md)                                             | Repository rules                                        |

## Current state

As of August 3, 2026, the implementation through Phase 9 is delivered and Phase 11 is
substantially built. Phase 1 is complete; Phases 2–8 are implementation-complete with their
owner-controlled release approvals still pending; Phase 9 passed its recorded G9 review; and Phase
11's G10 review is pending its own evidence, which is recorded in
[docs/development/phase-11-qa-matrix.md](docs/development/phase-11-qa-matrix.md) — including the
gaps no test closes. This is implementation evidence, not a claim that Verdery is generally
available.

The repository now contains the implemented foundation capabilities across the API, web, and native
Apple client: authentication and gardens; the canonical editable 2D garden map; plants,
observations, history, and tasks; native offline synchronization and recoverable web drafts; private
media upload, validation, derivatives, retention, plan import, and calibration; deterministic
recommendations, Today, notifications, export, and recoverable deletion. Phase 9 adds household/team
collaboration, professional organizations and garden assignments, a publication-only client portal
with factual timeline and client export, plus reviewed seasonal and garden-context surfaces.

Phase 11 adds plant candidates with suitability assessment and explicit conversion, six joined
search filters, a purpose-labelled visual journal — capture on both clients, and a plant's
photographs read back as an ordered comparison sequence — typed measurements, a taxon catalog whose
every fact names the source that asserted it, and shareable filter links on the web.

The development API and web application are deployed to `verdery-dev`, and the automatic
post-CI deployment verifies database migrations plus live API and web responses. Verdery 1.0 build
192 was uploaded successfully to TestFlight and entered Apple processing. CI is operational, but
`master` currently has no branch protection or repository ruleset requiring the aggregate
`All gates` check.

The product is not GA-ready. Only the development environment exists; staging and production remain
unprovisioned. App Check enforcement and optional AI/notification providers remain disabled pending
their evidence and owner decisions. The media workers are implemented but not deployed, several
real provider and horticultural-review decisions remain open, and App Store submission still needs
owner, privacy, account-deletion, screenshot, and real-device evidence. See
[docs/development/deferred-capabilities.md](docs/development/deferred-capabilities.md) and
[docs/development/ios-distribution.md](docs/development/ios-distribution.md) for the precise
boundaries.

## Repository layout

```text
apps/
├── ios/        Swift package for the Apple client (outside the pnpm workspace)
└── web/        Next.js web application

services/
├── api/        Fastify modular monolith over PostgreSQL and PostGIS
└── workers/    Async media, export, notification, and scheduled-processing workers

packages/
├── api-contracts/       OpenAPI document and the TypeScript client generated from it
├── geometry-contracts/  Canonical local-planar geometry semantics
├── localization/        Shared localization assets
└── test-fixtures/       Language-neutral JSON fixtures with a TypeScript loader

infrastructure/
├── gcloud/     Idempotent provisioning scripts for the verdery-dev environment (ADR-0011)
├── terraform/  Reserved for a future multi-environment phase (not yet populated)
└── firebase/   Firebase project configuration (not yet populated)

docs/
├── architecture/   Approved architecture and decision records
└── development/    Developer documentation for this repository

scripts/        Repository policy checks
.github/        Continuous integration
```

`apps/ios` is in the same repository but is not part of the JavaScript workspace. Swift Package
Manager is its build system, and `pnpm` commands never reach it.

Source: [docs/architecture/README.md](docs/architecture/README.md), section "5. Repository Shape".

## Prerequisites

Every version below is pinned by
[ADR-0009](docs/architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md) and enforced in
repository configuration, not merely documented.

| Tool                 | Required version             | Enforced by                                   | Needed for                       |
| -------------------- | ---------------------------- | --------------------------------------------- | -------------------------------- |
| Node.js              | 24.x (active LTS)            | `.nvmrc`, `engines` in `package.json`, CI     | Everything JavaScript/TypeScript |
| pnpm                 | 10.28.2                      | `packageManager` in `package.json`            | Everything JavaScript/TypeScript |
| TypeScript           | 5.9.x                        | `pnpm-lock.yaml`, `tsconfig.base.json`        | Everything JavaScript/TypeScript |
| Docker               | Any current release          | Testcontainers in the API test suite          | Database and migration tests     |
| PostgreSQL / PostGIS | 17 / 3.5                     | Test container image, Cloud SQL configuration | Database and migration tests     |
| Xcode                | 26.6 (iOS 26 SDK, Swift 6.3) | CI toolchain selection                        | The Apple client only            |

**Node.js 24 is required, not merely recommended.** On Node.js 22 every pnpm command prints:

```text
WARN  Unsupported engine: wanted: {"node":">=24.0.0 <25"} (current: {"node":"v22.x.x",...})
```

Installs and most scripts still run, but the local toolchain no longer matches CI, and any
behavioral difference between the two runtimes will surface as a CI failure that cannot be
reproduced locally. Upgrade before treating a local pass as evidence.

PostgreSQL is not installed directly: the API test suite starts a PostgreSQL 17 container through
Testcontainers, so a running Docker daemon is what a developer actually needs.

The Apple toolchain is only required when working in `apps/ios`. Everything else builds on Linux,
macOS, and Windows.

## First-time setup

```bash
# 1. Use the pinned Node.js version.
nvm install    # reads .nvmrc
nvm use

# 2. Let Corepack provide the pnpm version from the packageManager field.
corepack enable

# 3. Install dependencies exactly as the lockfile describes them.
pnpm install --frozen-lockfile

# 4. Build the workspace packages.
#    Packages are consumed through their compiled dist/, which is not committed,
#    so type checking and tests do not resolve until this has run once.
pnpm build

# 5. Confirm the checkout is healthy.
pnpm check:all
```

Full detail, including the environment variables each surface reads, is in
[docs/development/local-setup.md](docs/development/local-setup.md).

## Running each surface

| Surface      | Command                                                              | Notes                                                 |
| ------------ | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Web          | `pnpm --filter @verdery/web dev`                                     | Next.js development server on <http://localhost:3000> |
| API          | `pnpm --filter @verdery/api build && pnpm --filter @verdery/api dev` | Runs compiled output; requires `DATABASE_URL`         |
| Workers      | `pnpm --filter @verdery/workers build`                               | Builds worker targets; live rollout remains deferred  |
| Apple client | `cd apps/ios && swift build`                                         | Requires Xcode 26.6; `swift test` runs the suite      |

The API validates its configuration at startup and refuses to run with an invalid environment, so
`VERDERY_ENVIRONMENT` and `DATABASE_URL` must be set before it starts. See
[docs/development/local-setup.md](docs/development/local-setup.md).

## Running the checks

```bash
pnpm check:all
```

That is the aggregate gate, equivalent to running:

| Command                | Gate                                         |
| ---------------------- | -------------------------------------------- |
| `pnpm format:check`    | Prettier formatting, including Markdown      |
| `pnpm lint`            | ESLint, including module-boundary rules      |
| `pnpm typecheck`       | `tsc --noEmit` in every workspace package    |
| `pnpm check:file-size` | The 600-line source-file rule from AGENTS.md |
| `pnpm test`            | Vitest in every workspace package            |

Three contract gates are not part of `check:all` and run separately:

```bash
pnpm --filter @verdery/api-contracts lint:contract    # Redocly rules on openapi/root.yaml
pnpm --filter @verdery/api-contracts bundle:check     # openapi.yaml matches the openapi/ source tree
pnpm --filter @verdery/api-contracts generate:check   # generated client matches the bundle
```

Every gate above also runs in CI, plus a secret scan and the Swift build.
[docs/development/ci-gates.md](docs/development/ci-gates.md) maps each CI job to the command that
reproduces it locally. CI reports `All gates`, but that check is not yet enforced by branch
protection on `master`.

## Developer documentation

- [Local setup](docs/development/local-setup.md)
- [Database migrations](docs/development/database-migrations.md)
- [The API contract and generated clients](docs/development/api-contract.md)
- [CI gates](docs/development/ci-gates.md)
- [Deferred capabilities](docs/development/deferred-capabilities.md)
