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

Migrations belong to the API service and are run with `node-pg-migrate`:

```bash
pnpm --filter @verdery/api migrate up          # apply everything pending
pnpm --filter @verdery/api migrate down        # roll back the most recent migration
pnpm --filter @verdery/api migrate create <name>   # scaffold a new migration file
```

The script is defined in `services/api/package.json` as
`node-pg-migrate --migrations-dir migrations --envPath .env`, so:

- migration files live in `services/api/migrations`;
- the connection string is read from `DATABASE_URL` in `services/api/.env`, which is git-ignored and
  must never be committed.

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
traffic: the migration role owns the schema, and the application role receives only the data
privileges it needs. The application role can therefore never alter the schema, whatever a defect or
an injected statement asks it to do.

## What is not possible yet

Production migrations run through a dedicated cloud identity, and staging rehearses against
production-like volume. Neither environment exists — see
[deferred-capabilities.md](deferred-capabilities.md). Locally and in CI, migrations run against a
throwaway container, which proves correctness but not the operational procedure.
