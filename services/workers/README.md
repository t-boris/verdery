# Verdery Workers

Independently deployed workers for media verification, derivatives, and scheduled processing.

P6-ASYNC-01 added the transactional-outbox relay. P6-WORKER-01 added the authenticated media
validation target and real byte-validation pipeline. P6-WORKER-02 adds real derivative generation
(thumbnails, screen previews, high-resolution plan images, and XYZ tile pyramids), sharing this same
target and relay via job-kind dispatch — see below. P6-RET-01 adds the media-deletion job (the one
component in the whole system that deletes Cloud Storage objects) and the hourly retention-sweep
trigger. P7-ASYNC-01 adds two more scheduled sweep triggers (weather refresh, recommendation
evaluation) and generalizes the sweep scheduler/trigger machinery all three now share
(`src/sweeps/`).

A worker has its own composition root, service identity, configuration, health behavior, and
deployment. It shares versioned contract packages (`@verdery/api-contracts`) with the API but never
imports the running API application. See
[backend-modular-monolith.md](../../docs/architecture/backend-modular-monolith.md), section
"19. Worker Boundary".

## The transactional outbox relay (P6-ASYNC-01, extended by P6-WORKER-02)

`src/relay/outbox-relay.ts` scans `platform.outbox_event` for unpublished rows of any of THREE
recognized event types — `media.processing_requested` (appended by `@verdery/api`'s
`CompleteMediaUpload` when a media record reaches `available`), `media.derivative_generation_requested`
(appended by `@verdery/api`'s `RecordMediaProcessingResult` after a successful `media_validation`
result for a raster-eligible media class, P6-WORKER-02), or `media.deletion_requested` (appended by
the API's deletion workflow when a record is scheduled for deletion, P6-RET-01) — and for each one:

1. Creates a durable `media.processing_job` row, keyed by the triggering outbox event's own id, with
   `job_kind` set from the event's own type (`media_validation`, `derivative_generation`, or
   `media_deletion` — see `src/job-kind.ts`).
2. Enqueues a Cloud Tasks task carrying that job's manifest (now itself carrying `jobKind`), targeting
   this service at `POST /internal/media-validation-jobs/:jobId` — the SAME route for both job kinds,
   see "Job-kind dispatch" below.
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

## Job-kind dispatch (P6-WORKER-02)

`src/validation/validation-http-server.ts` (name unchanged from P6-WORKER-01, despite no longer being
validation-only — see that file's own header comment for why) is now given a
`src/media-processing-job-router.ts` `MediaProcessingJobRouter` as its processor instead of a bare
`ProcessMediaValidationJob`. The router reads the inbound manifest's own `jobKind` field
(`media_validation` when absent, for every manifest built before P6-WORKER-02 added the field) and
dispatches to `ProcessMediaValidationJob` (unchanged), `ProcessMediaDerivativeGenerationJob`
(P6-WORKER-02), or `ProcessMediaDeletionJob` (P6-RET-01). One HTTP route, one Cloud Tasks queue, one
task URL, one OIDC audience serve every job kind — see the P6-WORKER-02 report for why this was
chosen over parallel entrypoints.

## Derivative generation (P6-WORKER-02)

`src/derivatives/process-media-derivative-generation-job.ts` runs only against a media id whose OWN
`media_validation` job already succeeded (never against untrusted, unvalidated bytes — decoding here
is decoding an already-trusted file, the reasoning behind moving `sharp` from `devDependencies` to a
real production `dependencies` entry this stage):

1. Downloads the source object (the same bounded `MediaObjectSource`/`GcsMediaObjectSource` validation
   already uses).
2. Decodes once, applies EXIF orientation to the pixels, and strips ALL metadata (EXIF, ICC, XMP —
   GPS location included) unconditionally (`src/derivatives/image-derivative-generator.ts`).
3. Builds every derivative `src/derivatives/derivative-profile.ts`'s `derivativeProfileFor` names for
   this media class:
   - `garden_photo`: thumbnail (320px, JPEG q70) and screen preview (1600px, JPEG q82).
   - `imported_plan` (raster only — a PDF-classed plan gets no derivative yet, see "PDF page previews"
     below): thumbnail, screen preview, a high-resolution review image (4096px, JPEG q90 — a raster
     plan is used as a zoomable map background, unlike a garden photo), and a real XYZ/slippy-map tile
     pyramid (256px tiles, top-left origin, standard image-pyramid zoom levels down to a single-tile
     overview — `src/derivatives/tile-pyramid-generator.ts`).
4. Writes each produced derivative directly to the derived bucket (`MEDIA_DERIVED_BUCKET`) using this
   service's own runtime identity — `src/derivatives/gcs-derivative-object-sink.ts`, a real,
   server-initiated GCS write, unlike validation's read-only download or the API's own client-facing
   resumable-upload-session dance.
5. Posts a result whose `outputObjects` carry everything `@verdery/api`'s
   `record-media-processing-result.ts` needs to register each produced object as its own new
   `media.media_record` row — idempotent, addressed by `(derivedFromMediaId, transformationVersion,
derivativeKind[, tile coordinates])`, enforced by a real database constraint
   (`migrations/1785300000000_media-derivative-identity.sql`).

**PDF page previews are explicitly out of scope for this stage.** Rasterizing a PDF page needs either
`poppler`/`pdftoppm` (a native binary dependency, the same class already deferred for video/`ffprobe`)
or a heavier `pdf.js`+canvas WASM stack — neither is in this stack. A PDF-classed `imported_plan`
therefore never becomes derivative-eligible (`@verdery/api`'s own
`application/derivative-eligibility.ts` excludes it by content type) and gets no
preview/tile derivative yet.

## Media deletion (P6-RET-01)

`src/deletion/process-media-deletion-job.ts` executes the byte-removal half of the deletion
workflow (architecture/media-storage-and-processing.md section 16.1): for each bucket/prefix pair
the manifest's `deletion.objectPrefixes` carries — every object ever stored for one media record
lives under its own `<shard>/<mediaUuid>/` prefix, originals and derivatives alike — it deletes
every object (`src/deletion/gcs-object-deleter.ts`; an already-missing object is success, since
deletion is idempotent under at-least-once delivery), then RE-LISTS the prefix and reports
`succeeded` only on zero remaining objects (section 16 step 6's "verify absence" literally). A
verification or provider failure is a retryable throw (Cloud Tasks' bounded retries); the record
stays `deletion_scheduled` on the API side until absence is confirmed. IAM: listing rides the
existing `objectViewer` grants; the delete itself needs the custom `verderyMediaObjectDeleter` role
(`storage.objects.delete` only) `10-media-processing-queue.sh` creates and binds — written, not yet
executed live.

## Scheduled sweep triggers (P6-RET-01, generalized by P7-ASYNC-01)

`src/sweeps/interval-sweep-scheduler.ts` (the overlap-guarded interval loop — one in-flight run at
a time, an overlapping firing is skipped) drives `src/sweeps/google-api-sweep-trigger.ts`, which
POSTs to an authenticated internal API endpoint with an ID token minted for the same audience as
the result callback. Three sweeps share this machinery, each logging a structured completion
heartbeat on every round-trip (all-zero counts included):

- **Media retention** (`MEDIA_RETENTION_SWEEP_URL`, hourly): passed retention deadlines and stale
  never-completed uploads → the deletion workflow. `retention.sweep_completed`.
- **Weather refresh** (`WEATHER_REFRESH_SWEEP_URL`, hourly, P7-ASYNC-01): active georeferenced
  gardens through `RefreshGardenWeather` — cache-window aware, quota-honest, and with zero
  configured providers a typed no-op. `weather.refresh_sweep_completed`.
- **Recommendation evaluation** (`RECOMMENDATION_EVALUATION_SWEEP_URL`, six-hourly, P7-ASYNC-01):
  rule evaluation over eligible gardens plus candidate expiry.
  `recommendations.evaluation_sweep_completed`.

Every sweep itself — every privileged read and write — runs entirely in `services/api`:
`verdery_worker` has deliberately never been able to read `media.media_record`, any garden or plant
table, or the weather/recommendation tables, and these stages keep that boundary exactly as narrow
as it was. This process contributes only its interval loops and its already-verified identity. See
`src/sweeps/sweep-trigger.ts`'s own header comment.

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
| `MEDIA_DERIVED_BUCKET`                           | yes      | —                   | The derived bucket the derivative-generation job writes to directly |
| `MEDIA_RETENTION_SWEEP_URL`                      | yes      | —                   | The API's internal retention-sweep endpoint this worker triggers    |
| `MEDIA_RETENTION_SWEEP_INTERVAL_MS`              | no       | `3600000`           | How often the retention sweep is triggered                          |
| `WEATHER_REFRESH_SWEEP_URL`                      | yes      | —                   | The API's internal weather-refresh sweep endpoint (P7-ASYNC-01)     |
| `WEATHER_REFRESH_SWEEP_INTERVAL_MS`              | no       | `3600000`           | How often the weather-refresh sweep is triggered                    |
| `RECOMMENDATION_EVALUATION_SWEEP_URL`            | yes      | —                   | The API's internal recommendation-evaluation sweep endpoint         |
| `RECOMMENDATION_EVALUATION_SWEEP_INTERVAL_MS`    | no       | `21600000`          | How often the recommendation-evaluation sweep is triggered          |

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
