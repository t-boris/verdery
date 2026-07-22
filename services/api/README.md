# Verdery API

The Verdery backend: a Fastify modular monolith over PostgreSQL and PostGIS.

Phase 1 delivers the service shell only — composition root, configuration, health, typed errors,
correlated logging, the database boundary, and the platform baseline migration. It contains no
gardens, plants, maps, or authentication.

## Source Structure

```text
src/
├── main.ts                   process entry point
├── app.ts                    composition root
├── bootstrap/                lifecycle wiring shared by the entry point
├── platform/                 cross-cutting infrastructure
│   ├── configuration/
│   ├── database/
│   ├── errors/
│   └── telemetry/
└── modules/                  bounded domain modules
    └── service-health/
```

## Module Boundaries

Every module has the same shape, defined by
[backend-modular-monolith.md](../../docs/architecture/backend-modular-monolith.md), section
"5. Module Shape":

```text
module/
├── domain/           entities, value objects, policies, domain errors
├── application/      use cases, transaction coordination, declared ports
├── persistence/      Kysely repositories and module-owned queries
├── transport/        Fastify routes and HTTP mapping
├── tests/            module-level tests
└── public.ts         the module's only supported import surface
```

The rules are:

1. **The domain layer imports no infrastructure.** No Fastify, Kysely, `pg`, Firebase, or Google
   Cloud import may appear under `modules/*/domain/`. This is enforced by the repository ESLint
   configuration, not by convention.
2. **Cross-module imports go through `public.ts`.** A module never reaches into another module's
   `domain/`, `application/`, `persistence/`, or `transport/` directory. What a module offers to the
   rest of the service is exactly what its `public.ts` re-exports.
3. **Dependencies point inward.** `transport` depends on `application`, which depends on `domain`.
   The application layer declares ports; `persistence/` and `integration/` implement them.
4. **Modules never import `pg`.** Database access goes through `platform/database`'s
   `DatabaseGateway`, so the driver, pool policy, and transaction handling stay replaceable.
5. **Only the composition root wires modules.** `app.ts` constructs adapters and hands them to
   modules explicitly. There is no auto-loading and no runtime service container.

`service-health` is a complete example of the shape and is the module the health endpoints belong
to.

## Configuration

Every variable is validated at startup by `platform/configuration`. Startup fails on the first
invalid value and the failure names the offending variables; secret values never appear in a
message or a log. See [.env.example](.env.example) for the full list and its defaults.

## Database Migrations

Migrations are reviewed SQL files in [`migrations/`](migrations), applied with `node-pg-migrate`.
Each file contains an `-- Up Migration` and a `-- Down Migration` section.

```sh
export DATABASE_URL=postgresql://verdery:verdery@localhost:5432/verdery
pnpm --filter @verdery/api migrate up
pnpm --filter @verdery/api migrate down
```

Containers do not run migrations on startup: a migration is a controlled release step executed by a
dedicated identity. See
[environments-and-delivery.md](../../docs/architecture/environments-and-delivery.md), section
"12. Database Migrations".

## Tests

```sh
pnpm --filter @verdery/api test
```

Unit tests live beside their subject as `*.test.ts`; module tests live in `modules/*/tests/`; HTTP
and migration tests live in `tests/`.

The migration tests start a real `postgis/postgis:17-3.5` container through Testcontainers. They
**skip with an explicit message when no Docker daemon is reachable** — a green run without Docker
does not mean the migrations were verified. Start Docker and re-run to execute them.
