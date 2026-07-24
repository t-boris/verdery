# Verdery Workers

Independently deployed workers for media verification, derivatives, and scheduled processing.

P6-ASYNC-01 added the transactional-outbox relay. P6-WORKER-01 adds the authenticated media
validation target and real byte-validation pipeline.

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
2. Enqueues a Cloud Tasks task carrying that job's manifest, targeting this service at
   `POST /internal/media-validation-jobs/:jobId`.
3. Marks the outbox row published.

The relay is driven on a plain interval (`RELAY_POLL_INTERVAL_MS`) via `src/relay/poller.ts`.

This package's own database access is intentionally narrow: `src/relay/relay-database-schema.ts`
types only the two tables the relay's own least-privilege `verdery_worker` database role can reach
(`platform.outbox_event`, `media.processing_job`) — never `media.media_record` itself. See that
file's own header comment for why this is a deliberate, hand-maintained duplication of a small slice
of `@verdery/api`'s own schema, not a shared import.

See `src/relay/outbox-relay.ts`'s own header comment for the exact crash-recovery sequencing that
makes a relay run twice, or a relay that crashes mid-tick, safe.

## Media validation (P6-WORKER-01)

The Cloud Tasks handler:

1. Verifies the Google-signed OIDC token and exact worker service-account identity.
2. Streams exactly one private GCS object into a mode-`0600` temporary directory while enforcing
   the class byte limit and computing SHA-256.
3. Compares magic signature, declared type, display-filename extension, exact size, and any expected
   checksum.
4. Runs a bounded, pure-JS parser: header-only dimension reading (`image-size`) for raster images, or
   non-executing PDF structural and active-content checks. Images and PDF/documents only — see
   below.
5. Records dimensions/page count where applicable and the malware outcome.
6. Posts a structured, authenticated result to
   `POST /v1/internal/media-processing-jobs/:jobId/callback` on the API.

Images are limited to 40 megapixels and 16,384 pixels on either axis, read from header bytes alone
(never a full pixel decode — see `src/validation/image-metadata-parser.ts`'s own header comment for
why that is sufficient). PDFs are limited to 100 pages and reject encryption, JavaScript, launch
actions, embedded files, rich media, XFA, excessive object cardinality, and malformed envelopes.
Class byte limits are 25 MiB for garden photos, 50 MiB for imported plans, 50 MiB for derived
previews, and 1 GiB for processing output.

**Video/raw-capture is explicitly out of scope for this stage.** Duration, codec, and frame-rate
validation needs `ffprobe`, a native binary dependency not yet in this stack — the same reasoning
that keeps this validator's own MIME/dimension checks on pure-JS `file-type`/`image-size` rather than
a native decoder like `sharp`. A `raw_capture` manifest is short-circuited to an accepted result
before any object byte is downloaded, preserving the pre-existing declared-metadata-trusted level
P6-API-01 already established. No video parser exists anywhere in this package.

No malware provider has been selected. `UnavailableMalwareScanner` therefore reports scanner
unavailability honestly; PDF tasks return a retryable 503 and are never labelled clean. Raster plans
can still pass the constrained image parser. The provider decision remains explicit in
`docs/development/deferred-capabilities.md`.

## Environment

| Variable                                         | Required | Default             | Meaning                                                             |
| ------------------------------------------------ | -------- | ------------------- | ------------------------------------------------------------------- |
| `VERDERY_ENVIRONMENT`                            | yes      | —                   | `development`, `staging`, or `production`                           |
| `SERVICE_VERSION`                                | no       | `0.0.0-development` | Build version reported in every log record                          |
| `LOG_LEVEL`                                      | no       | `info`              | pino level                                                          |
| `HTTP_PORT`                                      | no       | `8080`              | Health and Cloud Tasks HTTP listener                                |
| `DATABASE_URL`                                   | yes      | —                   | The relay's own PostgreSQL connection string                        |
| `DATABASE_POOL_MAX_CONNECTIONS`                  | no       | `5`                 | Pool size                                                           |
| `DATABASE_CONNECTION_TIMEOUT_MS`                 | no       | `5000`              | Connection acquire timeout                                          |
| `DATABASE_STATEMENT_TIMEOUT_MS`                  | no       | `10000`             | Server-side statement timeout                                       |
| `RELAY_POLL_INTERVAL_MS`                         | no       | `5000`              | How often the relay scans for unpublished events                    |
| `RELAY_BATCH_SIZE`                               | no       | `20`                | Max events claimed per tick                                         |
| `MEDIA_PROCESSING_QUEUE_PROJECT_ID`              | yes      | —                   | Cloud Tasks queue project                                           |
| `MEDIA_PROCESSING_QUEUE_LOCATION`                | yes      | —                   | Cloud Tasks queue region                                            |
| `MEDIA_PROCESSING_QUEUE_NAME`                    | yes      | —                   | Cloud Tasks queue name                                              |
| `MEDIA_PROCESSING_TASK_URL`                      | yes      | —                   | This worker's validation route base URL and OIDC audience           |
| `MEDIA_PROCESSING_RESULT_CALLBACK_URL`           | yes      | —                   | The API's internal result callback base URL                         |
| `MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE`      | yes      | —                   | Audience used for the worker-to-API ID token                        |
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
docker build -f services/workers/Dockerfile -t verdery-workers .
```

`src/relay/outbox-relay.integration.test.ts` is a real-PostgreSQL Testcontainers suite (skipped
automatically when Docker is unavailable) — it applies `@verdery/api`'s own migrations to a scratch
container purely to get the real physical schema this package reads and writes; it does not import
that package's application code.
