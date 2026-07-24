# Verdery Workers

Independently deployed workers for media verification, derivatives, and scheduled processing.

Phase 1 delivered the deployment unit only: an entry point, validated configuration, structured
logging, and tests. P6-ASYNC-01 registers the first real job: the transactional-outbox relay for
media-processing jobs.

A worker has its own composition root, service identity, configuration, health behavior, and
deployment. It shares versioned contract packages (`@verdery/api-contracts`) with the API but never
imports the running API application. See
[backend-modular-monolith.md](../../docs/architecture/backend-modular-monolith.md), section
"19. Worker Boundary".

## The transactional outbox relay (P6-ASYNC-01)

`src/relay/outbox-relay.ts` scans `platform.outbox_event` for unpublished
`media.processing_requested` rows (appended by `@verdery/api`'s `CompleteMediaUpload` when a media
record reaches `available`), and for each one:

1. Creates a durable `media.processing_job` row, keyed by the triggering outbox event's own id.
2. Enqueues a Cloud Tasks task carrying that job's manifest, targeting the API's own internal
   callback endpoint (`POST /v1/internal/media-processing-jobs/:jobId/callback`).
3. Marks the outbox row published.

Driven on a plain interval (`RELAY_POLL_INTERVAL_MS`) via `src/relay/poller.ts`, not an
HTTP-triggered endpoint — this package has no inbound HTTP surface at all; it only makes outbound
calls (to PostgreSQL and to Cloud Tasks).

This package's own database access is intentionally narrow: `src/relay/relay-database-schema.ts`
types only the two tables the relay's own least-privilege `verdery_worker` database role can reach
(`platform.outbox_event`, `media.processing_job`) — never `media.media_record` itself. See that
file's own header comment for why this is a deliberate, hand-maintained duplication of a small slice
of `@verdery/api`'s own schema, not a shared import.

See `src/relay/outbox-relay.ts`'s own header comment for the exact crash-recovery sequencing that
makes a relay run twice, or a relay that crashes mid-tick, safe.

## Environment

| Variable                                         | Required | Default             | Meaning                                                             |
| ------------------------------------------------ | -------- | ------------------- | ------------------------------------------------------------------- |
| `VERDERY_ENVIRONMENT`                            | yes      | —                   | `development`, `staging`, or `production`                           |
| `SERVICE_VERSION`                                | no       | `0.0.0-development` | Build version reported in every log record                          |
| `LOG_LEVEL`                                      | no       | `info`              | pino level                                                          |
| `DATABASE_URL`                                   | yes      | —                   | The relay's own PostgreSQL connection string                        |
| `DATABASE_POOL_MAX_CONNECTIONS`                  | no       | `5`                 | Pool size                                                           |
| `DATABASE_CONNECTION_TIMEOUT_MS`                 | no       | `5000`              | Connection acquire timeout                                          |
| `DATABASE_STATEMENT_TIMEOUT_MS`                  | no       | `10000`             | Server-side statement timeout                                       |
| `RELAY_POLL_INTERVAL_MS`                         | no       | `5000`              | How often the relay scans for unpublished events                    |
| `RELAY_BATCH_SIZE`                               | no       | `20`                | Max events claimed per tick                                         |
| `MEDIA_PROCESSING_QUEUE_PROJECT_ID`              | yes      | —                   | Cloud Tasks queue project                                           |
| `MEDIA_PROCESSING_QUEUE_LOCATION`                | yes      | —                   | Cloud Tasks queue region                                            |
| `MEDIA_PROCESSING_QUEUE_NAME`                    | yes      | —                   | Cloud Tasks queue name                                              |
| `MEDIA_PROCESSING_CALLBACK_URL`                  | yes      | —                   | The API's own internal callback base URL                            |
| `MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL` | yes      | —                   | The service account Cloud Tasks mints the callback's OIDC token for |

`DATABASE_URL` only — no Cloud SQL IAM connection mode yet, unlike the API. Real Cloud SQL IAM
wiring for this package's own database connection is a documented follow-up; see
`src/configuration.ts`'s own header comment and
`infrastructure/gcloud/scripts/10-media-processing-queue.sh`'s own header comment for exactly what
remains.

## Commands

```sh
pnpm --filter @verdery/workers build
pnpm --filter @verdery/workers test
```

`src/relay/outbox-relay.integration.test.ts` is a real-PostgreSQL Testcontainers suite (skipped
automatically when Docker is unavailable) — it applies `@verdery/api`'s own migrations to a scratch
container purely to get the real physical schema this package reads and writes; it does not import
that package's application code.
