# Media Storage and Processing Design

> Status: Draft 0.4
> Decision status: Approved baseline  
> Last updated: July 28, 2026

## 1. Purpose

This document defines photo, video, plan, capture artifact, derivative, upload, download,
processing, retention, and deletion architecture using PostgreSQL metadata and private Google Cloud
Storage objects.

## 2. Principles

- Binary media bypasses the interactive API data path.
- PostgreSQL owns media identity, authorization, state, provenance, and retention.
- Cloud Storage object names are opaque infrastructure identifiers.
- All objects are private by default.
- Upload completion is verified before processing.
- The only local copy is never deleted before verified remote durability or deliberate user discard.
- Raw capture media has stricter retention than ordinary garden photos.

## 3. Media Classes

| Class             | Examples                                                                           | Baseline retention                                                                  |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Garden photo      | Plant and observation photos                                                       | Until user or garden deletion                                                       |
| Imported plan     | PDF, scan, raster plan                                                             | Until user or garden deletion                                                       |
| Raw capture       | Reserved future reconstruction source; AR/depth artifacts when explicitly retained | Not produced today; any future approved extraction-based default is at most 30 days |
| Derived preview   | Thumbnail, optimized image, plan tiles                                             | Rebuildable; lifecycle-managed                                                      |
| Processing output | Masks, point clouds, diagnostics                                                   | Policy by output type; raw diagnostics limited                                      |
| Export package    | User-requested ZIP                                                                 | Short-lived automatic expiration                                                    |

Retention can be shortened by the user or legal/privacy policy. Failed raw capture is retained only long enough for recovery and support policy.

## 4. Storage Layout

Use separate buckets by environment and sensitivity/purpose where operationally useful:

```text
grow-garden-<env>-user-media
grow-garden-<env>-raw-capture
grow-garden-<env>-derived
grow-garden-<env>-exports
```

Bucket names are examples; versioned environment provisioning configuration owns actual names.

Object keys are opaque and contain no email, garden name, address, or user-entered filename:

```text
<shard>/<mediaUuid>/<objectUuid>
```

## 5. Media Record

PostgreSQL stores:

- Media UUIDv7.
- Owning garden and creating actor.
- Media class and purpose.
- Original display filename after safe normalization.
- Declared and verified content type.
- Declared and verified byte size.
- SHA-256 or approved integrity checksum.
- Bucket and object key.
- Upload state.
- Processing state.
- Capture or observation relationships.
- Sensitivity classification.
- Retention deadline and deletion state.
- Original/derivative relationships.

Signed URLs and resumable session URLs are not persisted as identity.

## 6. Upload State Machine

```text
registered
    │
    ▼
authorized
    │
    ▼
uploading
    │
    ▼
verifying ─────► rejected
    │
    ▼
available ─────► processing ─────► processed
    │                 └──────────► processing_failed
    ▼
deletion_scheduled ──► deleted
```

Transitions are server-owned and revisioned.

## 7. Upload Flow

1. Client submits metadata, purpose, size, content type, and checksum when available.
2. API authenticates, authorizes garden access, validates quota and type, and creates a media record.
3. API creates a backend-authorized resumable Cloud Storage upload session, binding it to the
   caller's browser origin when the caller sends one and that origin is on the service's own
   allowlist.
4. Client uploads directly to Cloud Storage and persists local progress.
5. Completion event or explicit client call triggers verification.
6. The synchronous completion command compares authoritative object metadata with the registration,
   then emits a durable `media.processing_requested` event.
7. A private validation worker reads the bytes, posts a structured result, and the API records the
   job/media terminal state.
8. Signed access remains blocked until validation succeeds. Derivative work may begin only after
   that success.

Upload authorization is single-purpose, short-lived, size-bounded where supported, and scoped to one object.

Binding the session to an origin is a correctness requirement for browser clients, not a hardening
option. A session created without one still answers the browser's CORS preflight and its progress
probes, so an upload appears to work until its final data request, which returns success without
CORS headers and is therefore discarded unread by the browser — surfacing to the user as an
interrupted network connection. The origin arrives as a request header and is therefore untrusted:
it is honoured only when it already appears in the service's allowed-origins configuration, so a
session can never be bound to an origin the service does not otherwise serve. Native clients send
no origin and need none; their sessions are created unbound.

## 8. File Validation

Validation includes:

- Allowed media class and extension policy.
- MIME signature rather than filename alone.
- Maximum bytes and dimensions/duration where applicable.
- Decompression and parser-bomb protection.
- Checksum validation.
- Image metadata parsing in a sandboxed worker.
- Malware scanning for documents and other relevant formats.
- Rejection of active or unsupported content.

Unverified objects are isolated from normal downloads and processors.

### 8.1 Implemented validation profile (P6-WORKER-01)

Images and PDF/documents only. Raw reconstruction capture and retained AR artifacts are explicitly
out of scope — video duration/codec/frame-rate validation needs `ffprobe`, a native binary dependency
not present in this stack. A `raw_capture` manifest is accepted at today's
declared-metadata-trusted level without deep byte inspection; no committed feature produces it and no
video parser exists anywhere in this pipeline. Research does not authorize production ingestion.

| Media class       | Accepted types                    | Maximum bytes                              |
| ----------------- | --------------------------------- | ------------------------------------------ |
| Garden photo      | JPEG, PNG, WebP, HEIC, HEIF       | 50 MiB                                     |
| Imported plan     | Garden-photo raster types, PDF    | 50 MiB                                     |
| Raw capture       | Not deeply validated (see above)  | Declared byte size only, no worker ceiling |
| Derived preview   | Garden-photo raster types         | 50 MiB                                     |
| Processing output | Raster types, PDF                 | 1 GiB                                      |
| Export package    | No accepted validator profile yet | 2 GiB ceiling                              |

Raster dimension reading uses a pure-JS, header-only parser (no native image-decoding dependency, and
no full pixel decode) bounded to 40 megapixels and 16,384 pixels per axis — MIME signature is
verified separately, from magic bytes, also via a pure-JS detector. Never decoding pixel data is a
deliberate trade-off: the declared-dimension check plus the download's own streaming byte cap is this
stage's decompression/parser-bomb protection for images, at the cost of not catching corruption
confined entirely to a well-formed header's pixel payload. PDF preflight does not execute or
decompress content; it requires a valid envelope and cross-reference representation, limits documents
to 100 pages and 200 objects per page, and rejects encryption, JavaScript, launch actions, embedded
files, open actions, rich media, and XFA.

The current malware adapter is deliberately `unavailable`, not a fake clean result. PDF validation
therefore fails retryably until a provider is selected. Raster plans do not require the unavailable
document scanner and remain supported through the constrained image parser.

## 9. Image Derivatives

Approved image processing produces:

- Small thumbnail.
- Standard screen preview.
- High-resolution review image where required.
- Metadata-stripped derivative.

Orientation is normalized. EXIF location is removed from derivatives unless the product explicitly needs and authorizes it. Original metadata remains protected by original-object access policy.

Derivative generation is idempotent and addressed by source checksum plus transformation version.

### 9.1 Implemented derivative profile (P6-WORKER-02)

Real images only, for the two media classes real derivative production is grounded in a documented
use case: garden photos and raster (non-PDF) imported plans. A PDF-classed imported plan gets no
derivative yet — page rendering needs `poppler`/`pdftoppm` (a native binary dependency, the same class
already deferred for video/`ffprobe`) or a heavier `pdf.js`+canvas WASM stack; neither is evaluated or
present in this stack. See section 11.1 below.

| Derivative kind           | Media classes produced for | Long-edge size | Format | Quality  |
| ------------------------- | -------------------------- | -------------- | ------ | -------- |
| Thumbnail                 | Garden photo, raster plan  | 320 px         | JPEG   | 70       |
| Screen preview            | Garden photo, raster plan  | 1,600 px       | JPEG   | 82       |
| High-resolution review    | Raster plan only           | 4,096 px       | JPEG   | 90       |
| Tile (per XYZ coordinate) | Raster plan only           | 256 px tile    | PNG    | lossless |

None of these numbers is named anywhere else in this document; each is a reasoned default, documented
the same "no number decided yet, pick one and say so" posture `services/workers/src/configuration.ts`'s
own `RELAY_POLL_INTERVAL_MS`/`RELAY_BATCH_SIZE` comments and `09-media-storage.sh`'s own export-bucket
lifecycle rule already established:

- **Thumbnail/screen preview sizes** are ordinary grid-cell and full-screen-viewing bounds; never
  upscaled past a smaller source's own native resolution.
- **The high-resolution review image is built only for a raster plan, not a garden photo.** A plan
  document is used as a zoomable map background for tracing and calibration (section 8's plan-import
  flow reads a plan through to "trace or accept editable object proposals"; the map-rendering design's
  own "Plan Import and Calibration" describes recalibration and control-point placement against it) —
  a use case that plausibly zooms in past what a 1,600 px screen preview can render cleanly. A garden
  photo has no equivalent close-inspection use case named anywhere in this document; the screen
  preview, plus the original itself (still privately downloadable via signed access for the rare case
  someone needs full native detail), is judged sufficient. Building a third, redundant size for every
  garden photo uniformly was rejected as ungrounded invention.
- **All three raster sizes are JPEG**, trading a transparent source's alpha channel (flattened) for
  meaningfully smaller derivative bytes at a visually equivalent quality for in-app photo/plan-
  background display — the only use these three sizes serve.
- **Metadata stripping is unconditional, not selective**: every derivative this stage produces has
  ALL EXIF/ICC/XMP metadata removed (GPS location included), matching this section's own "EXIF
  location is removed ... unless the product explicitly needs and authorizes it" read literally —
  nothing in this codebase authorizes retaining any of it. EXIF orientation is applied to the pixels
  before the tag itself is stripped, so every derivative renders upright without a client reading EXIF.
- **Idempotency key**: `(derivedFromMediaId, transformationVersion, derivativeKind[, tileZoomLevel,
tileX, tileY])` — the addition of `derivativeKind` (and, for a tile, its XYZ coordinate) to this
  section's own "source checksum plus transformation version" phrase is necessary because one source
  now produces MULTIPLE derivatives per version (a thumbnail, a screen preview, optionally a
  high-resolution image, and for a plan, many tiles), which the original two-part key alone cannot
  distinguish between. Enforced by two real, partial unique database indexes
  (`migrations/1785300000000_media-derivative-identity.sql`), not just application-layer checking —
  regenerating the identical derivative for the identical source+version+kind is a real, database-
  guaranteed no-op.
- Each produced derivative becomes its OWN new `media.media_record` row (`media_class =
'derived_preview'`, `derivedFromMediaId`/`transformationVersion`/`derivativeKind` set), not a blob
  written to the derived bucket with no application-layer record — matching `media-record.ts`'s own
  pre-existing self-referencing model. Registration is a privileged write performed by `services/api`
  (`verdery_worker` has zero access to `media.media_record`), driven by the derivative-generation
  job's authenticated result payload, the same trust boundary P6-WORKER-01 established for validation
  outcomes.

### 11.1 Implemented tile pyramid defaults (P6-WORKER-02)

Standard XYZ/slippy-map addressing (`{z}/{x}/{y}`, top-left origin) — this app's own map rendering
(ADR-0005, P3-WEB-02) already uses MapLibre, which speaks this scheme natively, so this reuses it
rather than inventing a new convention. Tile size is 256 px, the universal default for this scheme
(the same default MapLibre, Leaflet, OpenStreetMap, and virtually every XYZ tile provider ship with);
no document anywhere in this repository names a tile size or zoom-level count, so 256 px is a reasoned
default, documented here explicitly.

Zoom levels follow standard image-pyramid construction: the deepest level (`maxZoomLevel`) tiles the
source at its own native resolution; each level below halves the resolution again, stopping at level 0
once a level fits in exactly one tile (a source already smaller than one tile produces a single level,
zoom 0, one tile). `maxZoomLevel = max(0, ceil(log2(maxNativeDimensionPx / 256)))`. Tile output is PNG,
not JPEG — a boundary tile whose level dimensions are not an exact multiple of 256 px is padded to a
full square with a transparent margin (JPEG has no alpha channel to pad with); MapLibre's XYZ raster
source expects uniform tile dimensions.

**PDF page-preview rendering is deliberately out of scope for this stage** (P6-WORKER-02). See section
9.1 above and `docs/development/deferred-capabilities.md`.

## 10. Video Handling

Raw video validation records duration, dimensions, codec, frame rate, and audio presence. Unsupported codecs may be transcoded in a worker or rejected with actionable guidance.

Video processing uses Cloud Run Jobs or specialized compute. Workers read from private storage using service identity and write versioned outputs to a derived bucket.

Video byte content never travels through Pub/Sub or Cloud Tasks payloads.

## 11. Plan Documents

PDF and raster plans are treated as sensitive documents. Processing may produce:

- Page previews.
- Tile pyramids.
- OCR or line-extraction proposals.
- Calibration metadata.

Original documents remain private. Browser rendering uses approved derived assets or short-lived access rather than public object URLs.

## 12. Download Flow

The client requests access by stable media ID. The API:

1. Authenticates the actor.
2. Authorizes the media purpose and garden role.
3. Selects an appropriate original or derivative.
4. Returns a short-lived signed or authorized download mechanism.
5. Records sensitive raw-access audit information where policy requires it.

Operational viewer role may access ordinary accepted photos according to garden capability but not
sensitive raw AR capture artifacts unless explicitly allowed. Any future reconstruction artifacts
inherit this denial until a promoted delivery phase defines a narrower policy.

Client access is different from viewer access. A client may download only a safe derivative or entitled original explicitly attached to a published client version, while the engagement is active and the publication remains visible. Garden ownership or media association alone does not make media client-visible.

### 12.1 Implemented listing and derivative-resolution profile (P6-PLAN-01)

Two client-blocking read gaps are now closed:

- **`ListGardenMedia`** (`GET /gardens/{gardenId}/media`): a garden's ORIGINAL media records, most
  recently created first, optionally filtered to one media class, under the API's ordinary
  cursor/limit pagination. Derivative rows are excluded by construction, never reachable through a
  `derived_preview` filter — a raster plan's tile pyramid alone can run to thousands of rows.
- **Derivative resolution**: the read operations a client displays media through (`GetMediaStatus`,
  `ListGardenMedia`) embed each record's available display derivatives — kind plus the derivative's
  OWN media id — as `Media.derivatives`. Only the non-tile kinds (thumbnail, screen preview,
  high-resolution) are listed, at the latest transformation version per kind; tiles are unbounded
  and their consumption is deferred (`docs/development/deferred-capabilities.md`). Embedding on the
  resource, rather than a sub-resource endpoint, was chosen because every consumer that reads a
  record's state also immediately needs its display derivative — one round trip instead of two,
  with a hard, small bound (at most three entries).

Step 3's "selects an appropriate original or derivative" is therefore CLIENT-side selection over an
explicit list, not server-side guessing: `GetMediaAccess` signs exactly the record it is asked for.
Its availability gate distinguishes the two shapes — an original requires `available` +
`processed` (validated clean); a derivative row is servable at `available` alone, because it only
ever exists as a worker's product from an already-validated source and its own `processingState` is
`null` by design.

## 13. Processing Manifest

Jobs receive a manifest containing:

- Job and media IDs.
- Input object references.
- Expected checksums.
- Media class, normalized display filename, expected content type, and expected byte size.
- Processor configuration version.
- Output object prefix or approved target IDs.
- Trace context.
- Callback or result-record contract.

The manifest contains no storage credentials. Workload identity grants access.

## 14. Processing Result

Workers publish or record:

- Processor version.
- Input checksums.
- Output objects and checksums.
- Structured result summary.
- Quality diagnostics.
- Resource and duration metrics.
- Terminal success, partial success, cancellation, or failure code.

The backend validates result ownership and expected job attempt before making derivatives visible.
The implemented path is Cloud Tasks → validation worker → authenticated API result callback. The
worker service account is checked at both inbound boundaries; the manifest and result contain no
credentials or signed URLs.

## 15. Retention and Lifecycle

Cloud Storage lifecycle rules perform only actions that align with PostgreSQL retention state and recovery policy.

- Raw successful capture defaults to deletion 30 days after extraction.
- Short-lived exports expire automatically after the communicated deadline.
- Rebuildable derivatives may transition to lower-cost storage or be regenerated.
- Ordinary user photos remain until deleted by user, garden, or account policy.
- Orphan detection reconciles objects without valid metadata and metadata without objects.

Lifecycle deletion must not race an active retry, support case, or legal hold.

### 15.1 Implemented retention profile (P6-RET-01)

One domain table (`services/api/src/modules/media/domain/media-retention.ts`) is the single source
both the user-visible policy statement (`GetMediaRetentionPolicy`, `GET /media/retention-policy`)
and the enforcing sweep read, so display and enforcement cannot drift. Honesty rules it:

- **`export_package` — 7 days from registration, ENFORCED.** The one duration-based rule computable
  today: no document names a number, but `09-media-storage.sh`'s exports-bucket lifecycle rule
  already chose and documented 7 days, and that script's own comment demands the application layer
  reconcile with it — `registerMediaRecord` now stamps `retention_deadline_at = registration + 7
days` on exactly this class, using the same constant.
- **`raw_capture` — 30 days after successful extraction, DECLARED but `enforced: false`.** The
  anchoring event has no producer because automated reconstruction is research-only and no committed
  feature collects production raw capture, so no raw-capture deadline is ever computed. The policy
  endpoint states the rule with an explicit `enforced` flag rather than claiming enforcement that
  does not run. The sweep mechanism already processes any record whose deadline passes if a future
  ADR and delivery phase authorize a producer.
- **Every other class** carries no duration-based rule (`retentionDays: null`, section 3's own
  "Until user or garden deletion" / "Rebuildable; lifecycle-managed" language), and nothing is
  invented.

**Orphan reconciliation** (this section's "metadata without objects", and section 17's "A failed
abandoned upload eventually releases reserved capacity"): the sweep also reconciles records still
in a pre-`available` upload state whose `updated_at` is older than **7 days** — grounded, not
arbitrary: a Cloud Storage resumable upload session is only resumable for one week, so an older
registration can never complete; the figure also matches the exports bucket's own 7-day precedent.
Because partial bytes may exist under an `authorized` target, reconciliation routes through the
REAL deletion workflow (section 16.1) rather than flipping rows terminal in place; a row that never
had a storage target completes to `deleted` in the same transaction. The quota reservation is
released when the row reaches `deleted`. A `rejected` record's bytes are deliberately NOT swept —
`rejected` is terminal evidence with no documented retention duration; see
`docs/development/deferred-capabilities.md`.

**Where the sweep runs**: in `services/api` (`RunMediaRetentionSweep`), triggered hourly by the
worker's own interval scheduler through an authenticated internal endpoint
(`POST /internal/media-retention/sweep`, verified with the same worker OIDC identity as the
processing-result callback). The worker deliberately gains NO database access for this:
`verdery_worker` has never been able to read `media.media_record`
(1785200000000_media-processing-jobs.sql's grant reasoning), and the sweep's reads and privileged
writes stay behind that boundary — the worker contributes only its poll loop (this codebase's one
established home for periodic work) and its already-verified identity. Candidates are processed in
bounded batches (25 per category per run), each in its own transaction. The reverse direction of
this section's orphan pairing — Cloud Storage objects with NO metadata row at all — has no listing
mechanism yet and is deferred (see `deferred-capabilities.md`); the prefix-scoped deletion design
below prevents the known ways such objects arise.

## 16. Deletion Workflow

Deletion is asynchronous and idempotent:

1. Revoke new access.
2. Mark media deletion scheduled.
3. Cancel eligible pending processing.
4. Delete derivatives.
5. Delete original and raw objects.
6. Verify absence or record provider retry state.
7. Purge or minimize metadata according to audit policy.
8. Emit completion.

User-visible deletion remains pending until required objects are confirmed deleted or a recoverable provider failure is reported internally.

### 16.1 Implemented deletion profile (P6-RET-01)

`services/api` owns every state transition; the worker owns the bytes; the two meet through the
same outbox/Cloud Tasks/callback machinery every processing job already rides. Step by step:

1-2. **Revoke access + mark scheduled** are ONE act: every read path already gates on `available`
(`GetMediaAccess`, derivative listing), so the revision-guarded `available → deletion_scheduled`
transition IS the revocation. Initiators: `DeleteGardenMedia`
(`POST /gardens/{gardenId}/media/{mediaId}/delete` — `editGardenContent`, If-Match-guarded,
replay-idempotent, originals only) and the retention sweep (15.1). Every derivative row is
bulk-transitioned with its source in the same transaction — a tile pyramid's thousands of rows make
this deliberately set-based, with the state gate in the statement's own `WHERE`.

3. **Cancel eligible pending processing**: every `requested`/`queued` job for the media is marked
   `cancelled` in the scheduling transaction. A Cloud Tasks dispatch already in flight cannot be
   recalled, so `RecordMediaProcessingResult` additionally guards BOTH processing kinds at result
   time: a result landing against a non-`available` source completes its job as `cancelled`
   (`media_not_available`) and never touches the record — and a late DERIVATIVE result's
   already-written bytes are re-covered by re-emitting the standard deletion event (idempotent: same
   prefixes, fresh event id, convergent completion).

4-5. **Delete derivatives, original, and raw objects**: the `media.deletion_requested` outbox event
(appended in the scheduling transaction) becomes a `media_deletion` job through the existing relay,
executed by `services/workers/src/deletion/` with the worker's own storage identity — the API never
deletes objects. Deletion is PREFIX-scoped, not key-enumerated: every object ever written for one
record — the original AND every derivative, registered or orphaned — lives under the same
`<shard>/<mediaUuid>/` prefix by construction (`objectKeyPrefixForMedia` and the worker's
`generateDerivativeObjectKey` share the identical shard computation, pinned by tests on both
sides), so two bucket/prefix pairs cover the entire fan-out in one bounded payload. A record that
never had a storage target skips the round-trip and completes in place.

6. **Verify absence or record retry state**: the worker re-lists each prefix after deleting and
   reports `succeeded` only on zero remaining objects; missing-on-delete is success (idempotent,
   at-least-once). A verification or provider failure is a retryable 5xx (Cloud Tasks' bounded
   retries), the job row is the internal retry record, and the media stays `deletion_scheduled` —
   user-visible deletion remains pending, exactly as this section requires.

7. **Purge or minimize metadata** is NOT this stage: the row survives at `deleted` as audit
   evidence; row purge belongs to the garden/account deletion workflows (data-export-and-deletion.md),
   which do not exist yet.

8. **Emit completion**: the succeeded callback drives `deletion_scheduled → deleted` (plus the
   derivative rows), releases the quota reservation (section 17's "released bytes" — including a
   `committed` one, legal exactly here because the bytes are confirmed gone), and records the
   `media.deleted` audit event; `media.deletion_requested` was audited with the initiating actor at
   scheduling. Both audits ride the workflow's own transactions.

**Referenced media cannot be deleted**: a record still referenced by a plant photo, observation
photo, task attachment, or imported-background map object answers `409 media.referenced` (one
detail per kind) and the whole scheduling transaction rolls back. The guard runs AFTER the row
update deliberately, paired with a `FOR SHARE` read (`MediaRepository.getForShare`) in every
attachment command — the two sides serialize on the media row, so neither ordering of the
attach-versus-delete race can leave an attachment pointing at deleted media. Attachment commands
also now require a same-garden, `available` record (closing a pre-existing gap where a bare
existence check allowed cross-garden references).

**IAM**: the worker's delete capability is a project-level CUSTOM role carrying exactly
`storage.objects.delete` (no predefined role grants delete without create/overwrite), bound per
bucket on all four media buckets — written in `10-media-processing-queue.sh`, not executed live,
the same boundary every grant in that script holds to.

## 17. Quotas

Quotas are applied to:

- File size.
- Video duration.
- Garden and account stored bytes.
- Concurrent uploads.
- Processing submissions.
- Raw retention volume.
- Export generation.

Quota reservation and release are idempotent. A failed abandoned upload eventually releases reserved capacity.

## 18. Security

- Uniform bucket-level access.
- Public access prevention.
- Least-privilege service accounts.
- Separate read/write permissions by worker role.
- No long-lived service-account keys.
- Signed access with short expiration.
- Sensitive access audit where practical.
- App Check on upload-session creation.
- Egress restrictions for untrusted parsers.

The validation worker materializes inputs only in a per-job temporary directory with mode `0600`,
deletes it in a `finally` path, and never logs object bytes, user filenames, or URLs.

## 19. Observability

Measure:

- Registered but never started uploads.
- Upload completion and verification time.
- Checksum and type mismatch.
- Processing queue age and duration.
- Derivative failures.
- Stored bytes by class and environment.
- Raw media approaching retention deadline.
- Deletion lag and orphan count.

Logs use media ID and classification, not signed URLs, user filenames, addresses, or content.

### 19.1 Implemented observability profile (P6-OBS-01)

Every signal above is now either a structured log event or a documented database/built-in-metric
query — see [observability-and-analytics.md](observability-and-analytics.md) section 13's "Media
dashboard, alert candidates, and runbook (P6-OBS-01)" subsection for the complete event table,
Cloud Logging queries, log-based metric definitions, dashboard widget compositions, alert
candidates with reasoned thresholds, and per-alert runbook entries. In brief:

- **Log events** (`verdery-api`): `media.upload.registered`, `media.upload.completed` (outcome +
  registration-to-completion time), `media.deletion.scheduled`, and
  `media.processing.result_recorded` — one event for validation, derivative, and deletion results
  alike, split by `jobKind`, carrying worker duration, full requested-to-completed pipeline
  latency, and (for a confirmed deletion) the computed `deletionLagMs`.
- **Log events** (`verdery-workers`): `relay.tick_completed` (now including
  `oldestClaimedEventAgeMs`, the outbox-publication-lag signal), `relay.event_failed`,
  `media_processing.job_failed_retryable` (renamed from its validation-only P6-WORKER-01 name,
  with `jobKind`), and `retention.sweep_completed` — emitted on every hourly run, zero counts
  included, so it doubles as the worker's liveness heartbeat.
- **Stock signals** (never started uploads, stored bytes by class, retention-deadline proximity,
  deletion-pending age, queue age) are documented SQL over `media.media_record`/
  `media.processing_job`, plus Cloud Monitoring's built-in per-bucket
  `storage.googleapis.com/storage/total_bytes`/`object_count` for physical stored bytes —
  deliberately not a hand-built exporter.

No live dashboard, metric, or alert policy is deployed by this work package — the documented,
copy-pasteable definitions above are the deliverable, matching the repository's established "-01
observability" bar.

## 20. Testing

- Resumable interruption and continuation.
- Duplicate completion notification.
- Declared versus actual type and size mismatch.
- Malformed image, video, and PDF fixtures.
- Active-content PDF, type spoofing, truncated image, checksum mismatch, and malware outcomes.
- Checksum mismatch.
- Unauthorized cross-garden access.
- Viewer access restrictions.
- Client publication-media entitlement, withdrawal, and engagement revocation.
- Internal media denial even when another item from the same work log is published.
- Derivative idempotency.
- Lifecycle and deletion race conditions.
- Orphan reconciliation.
- Account deletion across all buckets.

## 21. Completion Criteria

- Media bytes never pass through the interactive API.
- Unverified uploads cannot be processed or downloaded normally.
- Original and derivative identities are distinct and traceable.
- Approved raw AR capture retention is enforced and user-visible.
- No raw reconstruction artifact producer exists; any promoted feature must enforce and disclose
  retention before collecting such media.
- Signed access cannot bypass garden authorization.
- Client media access requires both publication entitlement and current engagement authorization.
- Deletion reaches every derivative and processing artifact.
- Processing is reproducible from versioned manifests where retained inputs permit it.

## 22. Current implementation boundary

P6-WORKER-01 is implemented in `services/workers/src/validation` with a production Dockerfile and
unit/malicious-fixture coverage. The API result callback records success, partial, terminal failure,
or cancellation through revision-guarded domain transitions, and signed access requires a successful
validation state.

P6-WORKER-02 is implemented in `services/workers/src/derivatives`: real thumbnail/screen-preview/
high-resolution/tile derivative generation via `sharp` (now a real production dependency, not the
devDependency-only test-fixture role it held in P6-WORKER-01), a direct GCS write to the derived
bucket, and idempotent registration of each produced derivative as its own new `media.media_record`
row through `services/api`'s extended `RecordMediaProcessingResult`
(`application/derivative-eligibility.ts`, `application/derivative-registration.ts`). A successful
`media_validation` job for a raster-eligible media class now appends a second outbox event
(`media.derivative_generation_requested`), reusing the same relay/Cloud Tasks/HTTP-callback machinery
P6-ASYNC-01/P6-WORKER-01 already built, dispatched by `job_kind` through one shared HTTP target
(`MediaProcessingJobRouter`). See section 9.1/11.1 above for the implemented derivative sizes and tile
defaults, and `docs/development/deferred-capabilities.md` for the PDF-page-preview gap this stage
deliberately leaves open.

P6-RET-01 is implemented across both services: the deletion workflow (sections 15.1/16.1 above) —
`DeleteGardenMedia`, the `media.deletion_requested` outbox event, the relay's third recognized
event type, the worker's `media_deletion` job (`services/workers/src/deletion/`, prefix-scoped
delete with absence verification), and the completion path in `RecordMediaProcessingResult`; the
retention sweep (`RunMediaRetentionSweep`, hourly worker-triggered through the authenticated
internal sweep endpoint); the export-package retention deadline stamped at registration; the
user-visible retention policy (`GetMediaRetentionPolicy`); deletion-versus-processing and
attach-versus-delete race guards, proven by Testcontainers race tests
(`tests/integration/media-deletion.test.ts`, `media-deletion-references.test.ts`,
`media-retention-sweep.test.ts`).

P6-OBS-01 is implemented across both services as structured logging plus documentation — see
section 19.1 above and observability-and-analytics.md's media subsection. It changes no pipeline
behavior: the API's media transport routes and the processing-result recording gained log
emissions (the latter by returning a per-delivery summary the callback route logs), and the worker
relay/sweep/HTTP-target log lines were extended or corrected in place.

Neither worker image has been deployed to `verdery-dev`. The existing Phase 6 platform follow-ups
still apply: worker Cloud SQL IAM connectivity, queue/service rollout, always-allocated CPU for the
interval relay, and selection/integration of a real malware scanner. The derived-bucket write IAM
grant this stage's own derivative-generation job needs (`roles/storage.objectCreator`, scoped to the
derived bucket) is written in `infrastructure/gcloud/scripts/10-media-processing-queue.sh` but not
executed against any real environment; P6-RET-01 adds, to that same written-not-executed list, the
custom `verderyMediaObjectDeleter` role (`storage.objects.delete` only, bound on all four media
buckets) and `deploy-workers.sh`'s `MEDIA_RETENTION_SWEEP_URL` variable.
