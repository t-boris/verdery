/**
 * Media processing job manifest and result contract (P6-ASYNC-01), plus the
 * deletion-workflow event contract (P6-RET-01) — split out of `index.ts`
 * purely for the repository's 600-line source-file rule; `index.ts`
 * re-exports everything here, so consumers keep importing from
 * `@verdery/api-contracts` unchanged.
 */

/**
 * Media processing job manifest and result contract (P6-ASYNC-01).
 *
 * Hand-written, not OpenAPI-generated: this is a machine-to-machine contract
 * between the API's transactional-outbox relay (`services/workers`) and the
 * API's own processing-result callback, never a client-facing HTTP request
 * or response body, so it has no place in `openapi.yaml`'s public surface —
 * the same reasoning that keeps `SharedErrorCode` and `API_BASE_PATH` here
 * as hand-written additions "OpenAPI cannot express" (see this file's own
 * header comment).
 *
 * `@verdery/api-contracts` is the shared, versioned contract package both
 * `services/api` and `services/workers` already depend on (see each
 * package's `package.json`) — exactly what architecture/backend-modular-
 * monolith.md section "19. Worker Boundary" means by "Workers share
 * versioned contracts and selected domain packages but do not import the
 * running API application." Neither service imports the other's `src/`;
 * both import this package's compiled types instead.
 *
 * Source: architecture/media-storage-and-processing.md, sections
 * "13. Processing Manifest", "14. Processing Result";
 * architecture/asynchronous-processing.md, sections "3. Message Envelope",
 * "10. Job State Machine".
 */

/**
 * The `platform.outbox_event.event_type` `CompleteMediaUpload` appends in
 * the same transaction as the `available` transition, and the exact value
 * `services/workers`' relay filters `platform.outbox_event` on. A shared
 * constant here means the producer (`services/api`) and the consumer
 * (`services/workers`) can never drift on the literal string independently.
 */
export const MEDIA_PROCESSING_REQUESTED_EVENT_TYPE = 'media.processing_requested';

/**
 * The `platform.outbox_event.payload` shape for
 * `MEDIA_PROCESSING_REQUESTED_EVENT_TYPE`. Carries everything the relay
 * needs to build a `MediaProcessingManifest` (below) directly from the
 * outbox row alone, so the relay never needs read access to
 * `media.media_record` itself — see `services/workers`' own relay for why
 * that narrower access footprint matters (architecture/media-storage-and-
 * processing.md section "18. Security": "Separate read/write permissions by
 * worker role").
 */
export interface MediaProcessingRequestedEventPayload {
  readonly mediaId: string;
  readonly gardenId: string | null;
  readonly mediaClass: string;
  readonly displayFilename: string;
  readonly bucketName: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly checksumSha256: string | null;
}

/**
 * The `platform.outbox_event.event_type` a successful `media_validation`
 * result appends for a raster-eligible media class (P6-WORKER-02;
 * `services/api`'s `application/derivative-eligibility.ts` decides which —
 * see that file's own header comment). The natural continuation of the SAME
 * outbox-driven design `MEDIA_PROCESSING_REQUESTED_EVENT_TYPE` established:
 * `services/workers`' relay filters `platform.outbox_event` on both event
 * types and enqueues a `derivative_generation` job for this one, reusing the
 * existing relay/Cloud Tasks/HTTP-callback machinery rather than inventing a
 * second dispatch mechanism.
 */
export const MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE =
  'media.derivative_generation_requested';

/**
 * The `platform.outbox_event.event_type` the media-deletion workflow
 * (P6-RET-01) appends in the same transaction as the `deletion_scheduled`
 * transition — by `DeleteGardenMedia` (a user deleting a photo), by the
 * retention sweep (a passed `retention_deadline_at`, or a stale
 * never-completed upload being orphan-reconciled), and by
 * `RecordMediaProcessingResult` cleaning up bytes a late derivative job
 * wrote for an already-deletion-scheduled source. `services/workers`' relay
 * recognizes it alongside the two processing event types and enqueues a
 * `media_deletion` job through the identical machinery.
 */
export const MEDIA_DELETION_REQUESTED_EVENT_TYPE = 'media.deletion_requested';

/**
 * One bucket + object-key prefix whose objects a `media_deletion` job
 * removes. Prefix-scoped, not an enumerated object list, deliberately:
 * every object key ever written for one media record — the original
 * (`services/api`'s `generateObjectKey`) and every derivative
 * (`services/workers`' `generateDerivativeObjectKey`) — shares the same
 * `<shard>/<mediaUuid>/` prefix by construction, where `<mediaUuid>` is the
 * SOURCE record's own id. Deleting by that prefix therefore reaches every
 * derivative (tiles included — a pyramid can run to thousands of objects a
 * payload could not reasonably enumerate) AND any orphaned bytes a
 * cancelled or late derivative job wrote without ever registering a row —
 * exactly section 15's "Orphan detection reconciles objects without valid
 * metadata". The prefix embeds the full media UUID, so it can never match
 * another record's objects.
 */
export interface MediaDeletionObjectPrefix {
  readonly bucketName: string;
  readonly objectKeyPrefix: string;
}

/**
 * The `platform.outbox_event.payload` shape for
 * `MEDIA_DELETION_REQUESTED_EVENT_TYPE` — the processing payload's own
 * fields (so the relay builds the shared manifest shape without a second
 * code path) plus the prefixes to delete. `checksumSha256` is always `null`
 * here: a deletion job verifies ABSENCE, not content, so there is no
 * checksum for its result to confirm and the job is created with no
 * expected input checksums.
 */
export interface MediaDeletionRequestedEventPayload extends MediaProcessingRequestedEventPayload {
  readonly objectPrefixes: readonly MediaDeletionObjectPrefix[];
}

/**
 * The `platform.outbox_event.payload` shape for
 * `MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE` — structurally
 * identical to `MediaProcessingRequestedEventPayload` (both name the same
 * private object the worker downloads and the same class/filename/content-
 * type/size facts a job needs), reused rather than duplicated. The one real
 * difference is `checksumSha256`: always non-null here — it carries the
 * REAL, worker-computed streaming SHA-256 from the validation job's own
 * successful result (`MediaProcessingResult.inputChecksums[0]`), not the
 * possibly-absent client-declared value `CompleteMediaUpload`'s own
 * `media.processing_requested` payload may carry.
 */
export type MediaDerivativeGenerationRequestedEventPayload = MediaProcessingRequestedEventPayload;

/**
 * One input object a processing job reads. Never a signed URL or credential
 * — section 13: "The manifest contains no storage credentials. Workload
 * identity grants access." The validation worker resolves
 * `bucketName`/`objectKey` through its own service identity.
 */
export interface MediaProcessingInputObject {
  readonly bucketName: string;
  readonly objectKey: string;
}

/**
 * The manifest a processing job receives (section 13's field list). Sent as
 * the Cloud Tasks HTTP task body — see `services/workers`' relay and
 * `services/api`'s processing-callback route, both of which import this
 * type rather than redeclaring it.
 *
 * `jobKind` is new in P6-WORKER-02 and OPTIONAL, not a breaking addition:
 * `services/workers`' `MediaProcessingJobRouter` treats an absent value as
 * `'media_validation'` — the one job kind this manifest shape was originally
 * designed for (P6-ASYNC-01/P6-WORKER-01) — so every manifest literal built
 * before this field existed (test fixtures included) keeps its original
 * meaning unchanged. The relay (`services/workers/src/relay/outbox-relay.ts`)
 * always sets it explicitly on every manifest it builds going forward, for
 * both job kinds.
 */
export interface MediaProcessingManifest {
  readonly jobId: string;
  readonly mediaId: string;
  /** Section 13: "Processor configuration version." A free-form version tag, not a semver requirement. */
  readonly processorConfigVersion: string;
  readonly inputObjects: readonly MediaProcessingInputObject[];
  /** Section 13: "Expected checksums." Empty when the source media carried none at registration. */
  readonly expectedChecksums: readonly string[];
  /**
   * Immutable facts captured from the accepted upload record. Validators
   * compare these values with bytes and parser output; they never trust
   * Cloud Storage metadata as a content signature. A derivative-generation
   * job reads the SAME fields for a different purpose: which media class's
   * derivative profile to build and what to name/label the source object —
   * it never re-runs policy validation, since it only ever receives a
   * manifest for a media id that already passed `media_validation` once.
   */
  readonly validation: {
    readonly mediaClass: string;
    readonly displayFilename: string;
    readonly expectedContentType: string;
    readonly expectedByteSize: number;
  };
  /** Section 13: "Trace context." Propagated from the domain command that triggered this job, when known. */
  readonly traceId?: string;
  /** See this interface's own doc comment above. `'media_validation'`, `'derivative_generation'`, or `'media_deletion'` (`services/api`'s `domain/processing-job.ts` owns the canonical string constants); absent means `'media_validation'`. */
  readonly jobKind?: string;
  /**
   * Present only on a `media_deletion` manifest (P6-RET-01): the
   * bucket/prefix pairs whose objects the job removes and verifies absent.
   * A processing manifest (validation, derivative generation) never carries
   * it. Optional rather than a second manifest type so the one HTTP
   * target, queue, and result contract stay shared — the same reasoning
   * `jobKind` itself documents above.
   */
  readonly deletion?: {
    readonly objectPrefixes: readonly MediaDeletionObjectPrefix[];
  };
}

/**
 * The four derivative kinds P6-WORKER-02 produces (architecture/
 * media-storage-and-processing.md section 9): a small thumbnail, a standard
 * screen preview, a high-resolution review image (raster plans only — see
 * this stage's own report for why garden photos do not get one), and one
 * raster-plan XYZ map tile (section 11's "Tile pyramids").
 */
export type MediaDerivativeKind = 'thumbnail' | 'screen_preview' | 'high_resolution' | 'tile';

/** XYZ/slippy-map tile addressing (top-left origin) — meaningful only when `MediaProcessingOutputObject.derivativeKind === 'tile'`. */
export interface MediaDerivativeTileCoordinates {
  readonly zoomLevel: number;
  readonly x: number;
  readonly y: number;
}

/**
 * One output object a processing job produced.
 *
 * `contentType`/`byteSize`/`derivativeKind`/`transformationVersion`/`tile`
 * are new in P6-WORKER-02 and OPTIONAL: a `media_validation` job's own
 * `outputObjects` stays permanently empty (unchanged from P6-WORKER-01), so
 * these fields are never populated for that job kind. A
 * `derivative_generation` job's result always sets all of them except
 * `tile` (present only when `derivativeKind === 'tile'`) — `services/api`'s
 * `record-media-processing-result.ts` treats an output object missing any
 * required field for its own `derivativeKind` as malformed and skips
 * registering it, rather than guessing.
 */
export interface MediaProcessingOutputObject {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
  readonly contentType?: string;
  readonly byteSize?: number;
  readonly derivativeKind?: MediaDerivativeKind;
  /** The derivative row's own `transformation_version` — see `media-record.ts`'s own doc comment on `MediaRecord.transformationVersion` and this stage's report for the idempotency key this, `derivedFromMediaId`, and `derivativeKind` (plus `tile` for a tile) together form. */
  readonly transformationVersion?: number;
  readonly tile?: MediaDerivativeTileCoordinates;
}

/**
 * Terminal outcome codes a processing job can reach (architecture/
 * asynchronous-processing.md section "10. Job State Machine"'s terminal and
 * near-terminal nodes reachable from a single delivery attempt: `succeeded`,
 * `partial`, `failed_terminal`, `cancelled`. `failed_retryable` and
 * `expired` are job STATES, not outcomes a result payload reports — a
 * retryable failure means no result was ever produced for that attempt.
 */
export type MediaProcessingOutcome = 'succeeded' | 'partial' | 'failed_terminal' | 'cancelled';

/**
 * The result a processing job records (section 14's field list). Validators
 * and future derivative processors share this versioned worker/API boundary.
 */
export interface MediaProcessingResult {
  readonly jobId: string;
  readonly processorVersion: string;
  readonly inputChecksums: readonly string[];
  readonly outputObjects: readonly MediaProcessingOutputObject[];
  readonly resultSummary: Record<string, unknown>;
  readonly qualityDiagnostics: Record<string, unknown> | null;
  readonly resourceMetrics: { readonly durationMs: number } | null;
  readonly outcome: MediaProcessingOutcome;
  /**
   * A 64-bit difference hash of the SOURCE image, as 16 lowercase hex
   * characters — absent when the job produced none (a non-image class, a
   * failed job, bytes the decoder refused).
   *
   * It describes the source, not any derivative, which is why it travels
   * here rather than on an entry in `outputObjects`. Its only use is
   * warning a person that a photograph they are uploading looks like one
   * the garden already holds; nothing depends on it, and a missing hash
   * degrades that warning to the exact-bytes check alone.
   */
  readonly sourcePerceptualHash?: string | null;
}
