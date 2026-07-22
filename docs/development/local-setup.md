# Local setup

How to get from an empty workstation to a checkout that passes every gate.

## 1. Toolchain

Install the pinned versions. Every one of them is enforced by repository configuration, so a
mismatch is visible rather than silent.

| Tool    | Version                      | Where the version comes from          |
| ------- | ---------------------------- | ------------------------------------- |
| Node.js | 24.x                         | `.nvmrc`, `engines` in `package.json` |
| pnpm    | 10.28.2                      | `packageManager` in `package.json`    |
| Docker  | any current release          | Testcontainers in the API test suite  |
| Xcode   | 26.6 (iOS 26 SDK, Swift 6.3) | Apple client only                     |

Source: [ADR-0009](../architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md).

```bash
nvm install     # reads .nvmrc, installs Node.js 24
nvm use
corepack enable # provides the pnpm version named by packageManager
```

### If you are on Node.js 22

Every pnpm command prints an unsupported-engine warning:

```text
WARN  Unsupported engine: wanted: {"node":">=24.0.0 <25"} (current: {"node":"v22.x.x",...})
```

The warning is not fatal — installs and most scripts still complete — but the local toolchain no
longer matches CI. Treat a local pass on Node.js 22 as unproven. ADR-0009 records this explicitly as
a consequence of the pin.

### If you are not working on the Apple client

Skip Xcode. `apps/ios` is deliberately outside the pnpm workspace, so no `pnpm` command builds it
and no workspace gate depends on it. Everything else builds on Linux, macOS, and Windows.

## 2. Install and build

```bash
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` is not optional on a fresh checkout. Workspace packages export their compiled
`dist/`, and `dist/` is not committed, so `pnpm typecheck` and `pnpm test` cannot resolve
`@verdery/geometry-contracts`, `@verdery/api-contracts`, or `@verdery/test-fixtures` until the
packages have been built at least once.

`--frozen-lockfile` is what makes the install reproducible. Use plain `pnpm install` only when you
are deliberately changing a dependency.

## 3. Verify

```bash
pnpm check:all
```

This runs formatting, linting, type checking, the file-size rule, and the tests. See
[ci-gates.md](ci-gates.md) for what each gate means and how CI runs it.

## 4. Run each surface

### Web

```bash
pnpm --filter @verdery/web dev
```

Serves the Next.js development server on <http://localhost:3000>.

| Variable                 | Required | Meaning                                                       |
| ------------------------ | -------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_API_ORIGIN` | No       | Origin of the API, without a trailing slash and without `/v1` |

`NEXT_PUBLIC_` variables are inlined into the client bundle, so a secret must never be given that
prefix. The declared list is `apps/web/environment.d.ts`.

Other web scripts: `build`, `start`, `typecheck`, `test`.

### API

```bash
pnpm --filter @verdery/api build
pnpm --filter @verdery/api dev
```

`dev` watches the _compiled_ output, not the TypeScript source. Run a build first, and keep a
`tsc --build --watch` running beside it if you want changes to take effect without a manual rebuild.
`start` runs the same compiled entry point without watching. Both load `dist/telemetry-bootstrap.js`
via Node's `--import` flag before `main.js`, required so OpenTelemetry's HTTP/Fastify/pg
instrumentation patches those modules before the app imports them — see
[infrastructure.md](infrastructure.md). It is a safe no-op locally: tracing only activates when
`TRACING_ENABLED=true`, which local development never sets.

Configuration is validated once at startup and the process refuses to start on an invalid
environment, so these must be set before it runs:

| Variable                   | Required                                 | Notes                                                             |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `VERDERY_ENVIRONMENT`      | Yes                                      | `development`, `staging`, or `production`                         |
| `DATABASE_CONNECTION_MODE` | No                                       | Defaults to `url`; `cloudSqlIam` is for the deployed service only |
| `DATABASE_URL`             | Yes, when `DATABASE_CONNECTION_MODE=url` | Treated as a secret; never logged                                 |

Everything else has a default. `services/api/src/platform/configuration/configuration-schema.ts` is
the authoritative list — read it rather than trusting a copy in documentation. See
[database-migrations.md](database-migrations.md), "Roles", for what `cloudSqlIam` mode is.

Source: [../architecture/backend-modular-monolith.md](../architecture/backend-modular-monolith.md),
section "10. Configuration".

### Workers

```bash
pnpm --filter @verdery/workers build
pnpm --filter @verdery/workers test
```

The workers package has no long-running entry point yet; the asynchronous pipeline arrives with a
later phase.

### Apple client

```bash
cd apps/ios
swift build
swift test
```

Or open `apps/ios/Package.swift` in Xcode 26.6. The package declares a macOS platform only so that
it builds and tests headlessly; no macOS product ships.

## 5. Database

There is no long-running local database to install. The API test suite starts PostgreSQL 17 with
PostGIS 3.5 in a container through Testcontainers, so a running Docker daemon is the actual
requirement. When you need a database for manual work, point `DATABASE_URL` at any PostgreSQL 17
instance with PostGIS 3.5 available and apply the migrations — see
[database-migrations.md](database-migrations.md).

## Troubleshooting

| Symptom                                                        | Cause                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Cannot find module '@verdery/…'` or missing type declarations | `pnpm build` has not run since the last clean checkout             |
| `Unsupported engine` warning on every command                  | Node.js is not 24.x                                                |
| Testcontainers cannot start a container                        | The Docker daemon is not running                                   |
| `ERR_PNPM_OUTDATED_LOCKFILE`                                   | A `package.json` changed without regenerating `pnpm-lock.yaml`     |
| `swift: command not found`                                     | Xcode command line tools are absent; not needed outside `apps/ios` |
