# Database migrations

Schema changes are a controlled release step, not something that happens on process startup. This
document covers the mechanics; the policy it implements is in
[../architecture/environments-and-delivery.md](../architecture/environments-and-delivery.md),
section "12. Database Migrations".

## The rules that shape everything below

- **Application containers never run uncontrolled migrations at startup.** A migration is an
  explicit step with its own identity and its own approval.
- **A migration must be compatible with the application version that is already running**, because
  during a rolling deployment both versions serve traffic at once.
- **Destructive change is a separate, later release.** Add first, migrate data, switch reads, and
  only then drop — one release per phase.
- **Migrations are reviewed SQL.** No ORM generates them.

Source: [../architecture/environments-and-delivery.md](../architecture/environments-and-delivery.md),
section "12. Database Migrations"; [../architecture/README.md](../architecture/README.md),
section "4. Approved Technology Profile", "Kysely with reviewed SQL migrations and explicit PostGIS
SQL".

## Tooling

Migrations belong to the API service and run through `services/api/src/migrate.ts`, a thin wrapper
around `node-pg-migrate`'s programmatic API rather than its bare CLI:

```bash
pnpm --filter @verdery/api build                    # migrate.ts runs compiled, like main.ts
pnpm --filter @verdery/api migrate                   # apply everything pending
pnpm --filter @verdery/api migrate:down              # roll back the most recent migration
pnpm --filter @verdery/api migrate:create <name>      # scaffold a new .sql migration file
```

`migrate.ts` resolves its database connection through the same `loadConfiguration()` the running
service uses, so it works unchanged in both connection modes:

- **`DATABASE_CONNECTION_MODE=url`** — an ordinary connection string in `DATABASE_URL`, exported
  locally (for example from `services/api/.env`, git-ignored and never committed) or supplied by the
  Testcontainers suite.
- **`DATABASE_CONNECTION_MODE=cloudSqlIam`** — no password anywhere. The connector authenticates as
  the process's own Google identity, and Postgres authorizes it through role membership. See
  "Roles" below and `infrastructure/gcloud/scripts/07-iam-database-bootstrap.sh`.

There is deliberately no separate "cloud migration script" — the connection mode is environment
configuration, not a code fork a person chooses.

Scaffolding a new file needs no database connection and works identically in either mode
(`migrate:create` forces the `.sql` template; the bare CLI defaults to `.js`, which is not this
project's convention).

## Writing a migration

1. Scaffold the file, then replace the generated body with reviewed SQL.
2. Name the change after what it does to the schema, not after the feature that needed it.
3. Keep the `up` and `down` directions in the same file, and make `down` genuinely reverse `up`. A
   migration whose rollback is untested is a migration that cannot be rolled back.
4. PostGIS objects are created with explicit SQL, including the extension itself and any spatial
   index.
5. Geometry columns use the local planar space — SRID 0 with an explicit `coordinate_space_id` —
   rather than a projected CRS.

Source: [ADR-0005](../architecture/decisions/ADR-0005-dual-space-geospatial-model.md);
[ADR-0010](../architecture/decisions/ADR-0010-local-coordinate-space-and-geometry-tolerances.md).

## The expand and contract sequence

A change that would break the running application is split across releases:

| Release | Phase    | Contains                                                                          |
| ------- | -------- | --------------------------------------------------------------------------------- |
| N       | Expand   | Add the new column, table, or index. Nullable or defaulted. Old code still works. |
| N       | Backfill | Populate the new shape, in batches if the table is large.                         |
| N+1     | Switch   | The application reads and writes the new shape. The old shape is still present.   |
| N+2     | Contract | Drop the old shape, once no deployed client or server still uses it.              |

The contract phase waits for mobile clients as well as servers. Released Apple clients keep talking
to the old shape for as long as users have not updated, so a column cannot be dropped on the
schedule of a server deployment alone.

Source: [../architecture/environments-and-delivery.md](../architecture/environments-and-delivery.md),
sections "12. Database Migrations" and "13. Mobile Compatibility".

## Testing a migration

The API test suite starts PostgreSQL 17 with PostGIS 3.5 in a container through Testcontainers, so
migration tests need a running Docker daemon and nothing else:

```bash
pnpm --filter @verdery/api test
```

Two properties are tested, and both matter:

- **Fresh.** An empty database reaches the current schema by applying every migration in order.
- **Upgrade.** A database at a representative prior schema reaches the same current schema. This is
  what catches a migration that only works on a database that has never held data.

Source: [../architecture/testing-strategy.md](../architecture/testing-strategy.md), section
"22. CI Gates", "Migration tests"; [../implementation-plan.md](../implementation-plan.md), section
10.2, work package `P1-DATA-01`, "Fresh and upgrade migration tests pass".

## Roles

The schema distinguishes the identity that changes the schema from the identity that serves
traffic: the migration role (`verdery_migration`) owns the schema, and the application role
(`verdery_application`) receives only the data privileges it needs. The application role can
therefore never alter the schema, whatever a defect or an injected statement asks it to do.

Both roles are created `NOLOGIN`. No password for either exists anywhere: a concrete identity —
a Cloud SQL IAM database user named after a service account — is granted membership in one or both
by `infrastructure/gcloud/scripts/07-iam-database-bootstrap.sh`, a script that must be run attended
because it briefly assigns Cloud SQL a public IP, restricted to the caller's own address, to perform
that grant.

`verdery_migration` also keeps a narrow, deliberate `CREATE` grant on the `public` schema — not
`PUBLIC` the pseudo-role, just this one trusted role — because `node-pg-migrate` needs somewhere to
create and write its own tracking table before it can run the first migration that would otherwise
create anywhere better. This was found the hard way: the migration suite passed for a long time
running only as the Testcontainers superuser, which bypasses schema privilege checks entirely, and
the real gap surfaced only once migrations ran through the actual least-privilege Cloud SQL IAM
identity. `services/api/tests/migrations/platform-baseline.test.ts` now has a dedicated test —
"re-applies idempotently through a least-privilege role, not only through the superuser" — that
connects as an ordinary role holding only the memberships that identity is granted, specifically to
keep this class of gap from reappearing silently.

## What is not possible yet

Migrations are proven twice now: against a throwaway Testcontainers container (fresh and upgrade,
in CI) and against the real `verdery-dev` Cloud SQL instance through the actual least-privilege IAM
identity, run as a Cloud Run Job with Direct VPC egress — the only path that can reach Cloud SQL's
private IP from outside the VPC, including from a GitHub Actions runner.

What remains unrehearsed is the operational procedure _across environments_: staging rehearsal
against production-like volume, and production migration through its own dedicated identity before
traffic shifts. Neither staging nor production exists yet — see
[deferred-capabilities.md](deferred-capabilities.md).
