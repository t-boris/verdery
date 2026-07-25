/**
 * Export generation machine-to-machine contract (P8-EXPORT-01).
 *
 * Hand-written, exactly like `media-processing.ts` and
 * `notification-dispatch.ts`: these are the HTTP/queue contracts between
 * `services/api` (the export request command, the internal snapshot/
 * checkpoint/completion endpoints) and `services/workers` (the outbox relay
 * and the `export_generation` job), never a client-facing HTTP body, so
 * none of it belongs in `openapi.yaml`'s public surface.
 *
 * THE SPLIT, in one place (architecture/data-export-and-deletion.md
 * sections 6-7; backend-modular-monolith.md section "19. Worker Boundary"):
 *
 * - `services/api` performs every PRIVILEGED DATABASE READ (the snapshot)
 *   and every domain-state write (request state machine, checkpoints,
 *   completion, the `export_package` media record) — `verdery_worker`'s
 *   grants stop at `platform.outbox_event` and `media.processing_job`, the
 *   same privilege wall that routes notification events and all four
 *   sweeps through internal API endpoints.
 * - `services/workers` moves every BYTE: it stages the snapshot's section
 *   content to the exports bucket, streams entitled media objects, and
 *   assembles the final ZIP — "Binary media bypasses the interactive API
 *   data path" (media-storage-and-processing.md section 2) applies to
 *   export packaging exactly as it does to derivative generation.
 */

/**
 * The `platform.outbox_event.event_type` `RequestExport` appends in the
 * same transaction as the `export_request` insert. The relay recognizes it
 * and enqueues one Cloud Tasks `export_generation` job (task name = event
 * id, so Cloud Tasks' own deduplication absorbs the publish-then-record
 * crash window) — no `media.processing_job` row is created for this
 * family: the `exports.export_request` row IS the durable job record, with
 * its own `requested -> running -> completed | failed` state machine and
 * per-section checkpoints, so a second job table keyed by media id (which
 * does not exist yet at request time) would model nothing real.
 */
export const EXPORT_REQUESTED_EVENT_TYPE = 'export.requested';

/**
 * The `platform.outbox_event.payload` shape for
 * `EXPORT_REQUESTED_EVENT_TYPE`. Deliberately thin: the relay only builds
 * an `ExportGenerationManifest` from it, and the worker re-reads
 * authoritative request state through the snapshot endpoint rather than
 * trusting a payload that could age in the outbox.
 */
export interface ExportRequestedEventPayload {
  readonly exportRequestId: string;
  readonly requesterProfileId: string;
  readonly scope: string;
  readonly gardenId: string | null;
  readonly includeMedia: boolean;
}

/**
 * The `platform.outbox_event.event_type` `CompleteExport` appends in the
 * same transaction as the `completed` transition and the `export_package`
 * media-record registration. The relay FORWARDS it whole to the API's
 * internal notification-policy endpoint (the `recommendation.
 * candidate_created` precedent), which creates the requester's
 * `export_ready` in-app intent.
 */
export const EXPORT_COMPLETED_EVENT_TYPE = 'export.completed';

/** The `platform.outbox_event.payload` shape for `EXPORT_COMPLETED_EVENT_TYPE`. */
export interface ExportCompletedEventPayload {
  readonly exportRequestId: string;
  readonly requesterProfileId: string;
  readonly scope: string;
  readonly gardenId: string | null;
  readonly outputMediaId: string;
  /** ISO-8601 instant the package (and therefore the notification) expires — the 7-day `export_package` retention deadline. */
  readonly expiresAt: string;
}

/** The worker job-kind vocabulary member this contract adds — `services/api`'s `domain/processing-job.ts` owns the three media kinds' canonical strings; this one is export-owned. */
export const EXPORT_GENERATION_JOB_KIND = 'export_generation';

/**
 * The Cloud Tasks task body for an `export_generation` job — a second
 * manifest FAMILY next to `MediaProcessingManifest`, not new optional
 * fields on it: an export job has no media id, no input objects, and no
 * validation block, so overloading the media manifest would force
 * fabricated values through a schema that means something else. The one
 * HTTP target, queue, and OIDC audience stay shared; the worker's job
 * router branches on `jobKind`.
 */
export interface ExportGenerationManifest {
  /** The triggering outbox event's own id — the Cloud Tasks task name, so redelivery is deduplicated. */
  readonly jobId: string;
  readonly jobKind: typeof EXPORT_GENERATION_JOB_KIND;
  readonly exportRequestId: string;
  readonly traceId?: string;
}

/**
 * Where a staged export artifact ultimately goes. `package` entries are
 * copied into the final ZIP under their `entryPath`; `transfer` entries
 * exist only to carry worker-internal facts (bucket names and object keys
 * of entitled media) from the API's snapshot to the worker's assembly pass
 * and are NEVER placed in the user-visible package — internal storage
 * keys stay internal (data-export-and-deletion.md section 9's posture for
 * URLs, applied to object keys).
 */
export type ExportSectionDisposition = 'package' | 'transfer';

/**
 * One structured section the snapshot endpoint returns. `content` is the
 * full UTF-8 text (JSON / GeoJSON / CSV / Markdown) — structured exports
 * are metadata-scale, so text-in-response is honest; media BYTES never
 * travel through this response (the worker streams those from Cloud
 * Storage itself, per this file's header).
 */
export interface ExportSnapshotSection {
  readonly entryPath: string;
  readonly disposition: ExportSectionDisposition;
  readonly contentType: string;
  readonly content: string;
}

/** One already-recorded section checkpoint: where the worker previously staged this section, and what bytes it must contain. */
export interface ExportSectionCheckpoint {
  readonly entryPath: string;
  readonly disposition: ExportSectionDisposition;
  readonly bucketName: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly byteSize: number;
}

/**
 * `POST /internal/exports/{exportRequestId}/snapshot`'s response.
 *
 * Exactly one of two shapes, by `checkpoints`:
 * - No checkpoints yet: `sections` carries the FULL structured snapshot,
 *   read inside one `REPEATABLE READ, READ ONLY` transaction whose MVCC
 *   snapshot IS the export's consistency boundary (`boundaryAt` is that
 *   transaction's own clock reading). All-or-nothing per attempt: a retry
 *   that arrives before the checkpoint write re-reads EVERYTHING under a
 *   fresh snapshot, so the staged set is always internally consistent.
 * - Checkpoints recorded: `sections` is empty and the worker resumes from
 *   the staged objects — the snapshot is never re-read once checkpointed,
 *   which is what makes the recorded `boundaryAt` a real boundary.
 *
 * `state` lets a redelivered task no-op honestly against an already
 * `completed`/`failed` request.
 */
export interface ExportSnapshotResponse {
  readonly exportRequestId: string;
  readonly state: string;
  readonly scope: string;
  readonly includeMedia: boolean;
  readonly formatVersion: string;
  /** ISO-8601. Null only while `state` is `requested`/`running` with no snapshot taken yet — impossible in the same response as a non-empty `sections`. */
  readonly boundaryAt: string | null;
  /** The exports-bucket target the final ZIP must be written to — pre-computed at request time so the object key embeds the pre-minted `export_package` media UUID (prefix-scoped deletion reaches it). */
  readonly packageTarget: {
    readonly bucketName: string;
    readonly objectKey: string;
  };
  /** The exports-bucket prefix the worker stages section objects under. */
  readonly stagingObjectKeyPrefix: string;
  readonly checkpoints: readonly ExportSectionCheckpoint[];
  readonly sections: readonly ExportSnapshotSection[];
}

/** `POST /internal/exports/{exportRequestId}/checkpoints`'s request body: every staged section of one snapshot attempt, recorded atomically with its boundary. */
export interface ExportCheckpointRequest {
  /** ISO-8601 — echoes the snapshot response's `boundaryAt`; persisted with the checkpoints so a later attempt resumes against the same recorded boundary. */
  readonly boundaryAt: string;
  readonly sections: readonly ExportSectionCheckpoint[];
}

/** How the worker's assembly pass concluded — mirrors `MediaProcessingOutcome`'s success/terminal split; a retryable failure reports nothing (the attempt simply retries). */
export type ExportGenerationOutcome = 'succeeded' | 'failed_terminal';

/**
 * `POST /internal/exports/{exportRequestId}/complete`'s request body.
 * `package` is present exactly when `outcome` is `succeeded`. Idempotent:
 * a replay against an already-completed request is a no-op 200.
 */
export interface ExportCompletionRequest {
  readonly outcome: ExportGenerationOutcome;
  readonly package?: {
    readonly bucketName: string;
    readonly objectKey: string;
    readonly contentType: string;
    readonly byteSize: number;
    readonly checksumSha256: string;
    /** Media files actually placed in the package. */
    readonly mediaFileCount: number;
    /** Entitled media listed at the boundary but absent from storage at assembly time — listed explicitly in the package's `missing-media.json`, never silently omitted (section 7). */
    readonly missingMediaCount: number;
  };
  /** Present exactly when `outcome` is `failed_terminal` — a stable machine reason, never free prose. */
  readonly failureCode?: string;
}

/** The schema version stamped into every package's `export.json` — bump when the PACKAGE layout changes incompatibly, independent of the API contract version. */
export const EXPORT_FORMAT_VERSION = '1';

/**
 * The `transfer`-disposition section carrying the entitled media files'
 * internal storage locations from the API's snapshot to the worker's
 * assembly pass — named by shared constant so producer (`services/api`'s
 * section builder) and consumer (the worker's assembly) can never drift on
 * the literal string. Never placed in the final package.
 */
export const EXPORT_MEDIA_TRANSFER_ENTRY_PATH = 'media-transfer.json';

/** One entry of the transfer manifest's `files` array — worker-internal facts only. */
export interface ExportMediaTransferFile {
  readonly mediaId: string;
  readonly entryPath: string;
  readonly bucketName: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly expectedByteSize: number;
  readonly expectedChecksumSha256: string | null;
}

/** The transfer manifest's own JSON shape. */
export interface ExportMediaTransferManifest {
  readonly files: readonly ExportMediaTransferFile[];
}
