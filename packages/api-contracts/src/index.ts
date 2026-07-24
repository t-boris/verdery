/**
 * Public surface of the API contract package.
 *
 * The OpenAPI document is the source of truth; `src/generated/schema.ts` is
 * derived from it and is never edited by hand. This module re-exports the
 * generated types under stable names and adds the small amount of hand-written
 * material that OpenAPI cannot express, such as the error-code catalogue.
 *
 * Source: architecture/api-design.md, section "3. Contract Ownership".
 */

import type { components, paths } from './generated/schema.js';

export type { components, paths };

export type Schemas = components['schemas'];

export type ApiError = Schemas['Error'];
export type ErrorDetail = Schemas['ErrorDetail'];
export type LivenessResult = Schemas['LivenessResult'];
export type ReadinessResult = Schemas['ReadinessResult'];
export type DependencyStatus = Schemas['DependencyStatus'];
export type GeometryEnvelope = Schemas['GeometryEnvelope'];
export type Geometry = Schemas['Geometry'];
export type Position = Schemas['Position'];
export type CoordinateSpaceKind = Schemas['CoordinateSpaceKind'];
export type ProvenanceKind = Schemas['ProvenanceKind'];
export type CurveMetadata = Schemas['CurveMetadata'];
export type Garden = Schemas['Garden'];
export type GardenRole = Schemas['GardenRole'];
export type GardenLifecycleState = Schemas['GardenLifecycleState'];
export type GardenListResult = Schemas['GardenListResult'];
export type CreateGardenRequest = Schemas['CreateGardenRequest'];
export type RenameGardenRequest = Schemas['RenameGardenRequest'];
export type SessionLoginRequest = Schemas['SessionLoginRequest'];

/**
 * The garden map schemas (P3-CONTRACT-01).
 *
 * Every `oneOf` discriminator here (`GardenObjectDetails`, `Geometry`,
 * `MapCommandPayload`) declares an explicit `mapping` in `openapi.yaml`, so
 * `openapi-typescript` types each branch's discriminator property with the
 * real wire value (`"createObject"`, `"structure"`, `"Point"`) and these
 * generated types narrow a real API response or request body correctly.
 * This was not always true: without `mapping`, the generator falls back to
 * typing the discriminator as the referenced component's own *name*
 * (`"CreateMapObjectCommand"`, `"StructureDetails"`) instead — confirmed
 * directly while building the map module's transport layer, and fixed by
 * adding `mapping` to all three discriminators rather than working around
 * it per consumer.
 */
export type GardenObjectCategory = Schemas['GardenObjectCategory'];
export type GardenObjectLifecycleState = Schemas['GardenObjectLifecycleState'];
export type GardenObjectDetails = Schemas['GardenObjectDetails'];
export type StructureDetails = Schemas['StructureDetails'];
export type FenceDetails = Schemas['FenceDetails'];
export type GateDetails = Schemas['GateDetails'];
export type ZoneDetails = Schemas['ZoneDetails'];
export type BedDetails = Schemas['BedDetails'];
export type TreeDetails = Schemas['TreeDetails'];
export type PlantPlacementDetails = Schemas['PlantPlacementDetails'];
export type UtilityExclusionDetails = Schemas['UtilityExclusionDetails'];
export type AnnotationDetails = Schemas['AnnotationDetails'];
export type GardenObject = Schemas['GardenObject'];
export type GardenMapDocument = Schemas['GardenMapDocument'];
export type Georeference = Schemas['Georeference'];
export type ValidationSeverity = Schemas['ValidationSeverity'];
export type ValidationIssue = Schemas['ValidationIssue'];
export type VertexOperation = Schemas['VertexOperation'];
export type ProposalDecision = Schemas['ProposalDecision'];
export type MeasurementUnit = Schemas['MeasurementUnit'];
export type MeasurementAcquisitionMethod = Schemas['MeasurementAcquisitionMethod'];
export type Measurement = Schemas['Measurement'];
export type CreateMapObjectCommand = Schemas['CreateMapObjectCommand'];
export type MoveObjectCommand = Schemas['MoveObjectCommand'];
export type ReplaceGeometryCommand = Schemas['ReplaceGeometryCommand'];
export type EditVertexCommand = Schemas['EditVertexCommand'];
export type SplitLineworkCommand = Schemas['SplitLineworkCommand'];
export type JoinLineworkCommand = Schemas['JoinLineworkCommand'];
export type ChangePropertiesCommand = Schemas['ChangePropertiesCommand'];
export type AssignPlantCommand = Schemas['AssignPlantCommand'];
export type UpsertCalibrationCommand = Schemas['UpsertCalibrationCommand'];
export type DecideProposalCommand = Schemas['DecideProposalCommand'];
export type DeleteObjectCommand = Schemas['DeleteObjectCommand'];
export type RestoreObjectCommand = Schemas['RestoreObjectCommand'];
export type DuplicateObjectCommand = Schemas['DuplicateObjectCommand'];
export type MapCommandPayload = Schemas['MapCommandPayload'];
export type MapCommandRequest = Schemas['MapCommandRequest'];
export type MapCommandResult = Schemas['MapCommandResult'];

/** The plants-inventory schemas (P4-CONTRACT-01). */
export type PlantGroupingKind = Schemas['PlantGroupingKind'];
export type PlantAcquisitionDateType = Schemas['PlantAcquisitionDateType'];
export type PlantLifecycleStage = Schemas['PlantLifecycleStage'];
export type PlantStatus = Schemas['PlantStatus'];
export type TaxonomySource = Schemas['TaxonomySource'];
export type Plant = Schemas['Plant'];
export type PlantListResult = Schemas['PlantListResult'];
export type PlantPhoto = Schemas['PlantPhoto'];
export type TaxonomyReference = Schemas['TaxonomyReference'];
export type TaxonomyReferenceListResult = Schemas['TaxonomyReferenceListResult'];
export type AddPlantRequest = Schemas['AddPlantRequest'];
export type AddPlantFromPhotoRequest = Schemas['AddPlantFromPhotoRequest'];
export type UpdatePlantDetailsRequest = Schemas['UpdatePlantDetailsRequest'];
export type AttachPlantPhotoRequest = Schemas['AttachPlantPhotoRequest'];
export type TransitionPlantLifecycleStageRequest = Schemas['TransitionPlantLifecycleStageRequest'];
export type SetPlantStatusRequest = Schemas['SetPlantStatusRequest'];
export type MovePlantRequest = Schemas['MovePlantRequest'];

/** The observations-history schemas (P4-CONTRACT-01). */
export type ObservationActorType = Schemas['ObservationActorType'];
export type ObservationCorrectionKind = Schemas['ObservationCorrectionKind'];
export type ImageAnalysisKind = Schemas['ImageAnalysisKind'];
export type ImageAnalysisResult = Schemas['ImageAnalysisResult'];
export type ObservationPhoto = Schemas['ObservationPhoto'];
export type Observation = Schemas['Observation'];
export type ObservationListResult = Schemas['ObservationListResult'];
export type RecordObservationRequest = Schemas['RecordObservationRequest'];
export type CorrectObservationRequest = Schemas['CorrectObservationRequest'];

/** The tasks-recommendations schemas (P4-CONTRACT-01). */
export type TaskTargetKind = Schemas['TaskTargetKind'];
export type TaskStatus = Schemas['TaskStatus'];
export type TaskUrgency = Schemas['TaskUrgency'];
export type TaskSource = Schemas['TaskSource'];
export type Task = Schemas['Task'];
export type TaskAttachment = Schemas['TaskAttachment'];
export type TaskListResult = Schemas['TaskListResult'];
export type TaskTimeWindowInput = Schemas['TaskTimeWindowInput'];
export type CreateManualTaskRequest = Schemas['CreateManualTaskRequest'];
export type EditTaskRequest = Schemas['EditTaskRequest'];
export type RescheduleTaskRequest = Schemas['RescheduleTaskRequest'];
export type CompleteTaskRequest = Schemas['CompleteTaskRequest'];
export type DismissTaskRequest = Schemas['DismissTaskRequest'];
export type AttachTaskFileRequest = Schemas['AttachTaskFileRequest'];

/** The media schemas (P6-API-01). */
export type MediaClass = Schemas['MediaClass'];
export type MediaUploadState = Schemas['MediaUploadState'];
export type MediaProcessingState = Schemas['MediaProcessingState'];
export type MediaSensitivityClassification = Schemas['MediaSensitivityClassification'];
export type Media = Schemas['Media'];
export type RegisterMediaUploadRequest = Schemas['RegisterMediaUploadRequest'];
export type MediaUploadSession = Schemas['MediaUploadSession'];
export type MediaAccess = Schemas['MediaAccess'];

/**
 * The synchronization schemas (P5-API-01).
 *
 * `SyncOperationPayload` groups by target record family (`garden`,
 * `gardenObject`, `plant`, `observation`, `task`), discriminated on
 * `recordType`; each family's own `command` union is then discriminated a
 * second time on `commandType` (or, for `gardenObject`, reuses
 * `MapCommandPayload`'s existing `type` discriminator unchanged). See
 * `SyncOperationPayload`'s own description in `openapi.yaml` for why this is
 * two nested unions rather than one flat one.
 */
export type SyncRecordType = Schemas['SyncRecordType'];
export type SyncRecordReference = Schemas['SyncRecordReference'];
export type Calibration = Schemas['Calibration'];
export type SyncGardenSnapshot = Schemas['SyncGardenSnapshot'];
export type SyncGardenObjectSnapshot = Schemas['SyncGardenObjectSnapshot'];
export type SyncCalibrationSnapshot = Schemas['SyncCalibrationSnapshot'];
export type SyncPlantSnapshot = Schemas['SyncPlantSnapshot'];
export type SyncObservationSnapshot = Schemas['SyncObservationSnapshot'];
export type SyncTaskSnapshot = Schemas['SyncTaskSnapshot'];
export type SyncRecordSnapshot = Schemas['SyncRecordSnapshot'];
export type SyncChange = Schemas['SyncChange'];
export type SyncChangesResult = Schemas['SyncChangesResult'];
export type SyncCreateGardenCommand = Schemas['SyncCreateGardenCommand'];
export type SyncRenameGardenCommand = Schemas['SyncRenameGardenCommand'];
export type SyncArchiveGardenCommand = Schemas['SyncArchiveGardenCommand'];
export type SyncRequestGardenDeletionCommand = Schemas['SyncRequestGardenDeletionCommand'];
export type SyncGardenCommand = Schemas['SyncGardenCommand'];
export type SyncAddPlantCommand = Schemas['SyncAddPlantCommand'];
export type SyncAddPlantFromPhotoCommand = Schemas['SyncAddPlantFromPhotoCommand'];
export type SyncUpdatePlantDetailsCommand = Schemas['SyncUpdatePlantDetailsCommand'];
export type SyncAttachPlantPhotoCommand = Schemas['SyncAttachPlantPhotoCommand'];
export type SyncSetPrimaryPlantPhotoCommand = Schemas['SyncSetPrimaryPlantPhotoCommand'];
export type SyncConfirmPlantIdentificationCommand =
  Schemas['SyncConfirmPlantIdentificationCommand'];
export type SyncTransitionPlantLifecycleStageCommand =
  Schemas['SyncTransitionPlantLifecycleStageCommand'];
export type SyncSetPlantStatusCommand = Schemas['SyncSetPlantStatusCommand'];
export type SyncMovePlantCommand = Schemas['SyncMovePlantCommand'];
export type SyncPlantCommand = Schemas['SyncPlantCommand'];
export type SyncRecordObservationCommand = Schemas['SyncRecordObservationCommand'];
export type SyncCorrectObservationCommand = Schemas['SyncCorrectObservationCommand'];
export type SyncObservationCommand = Schemas['SyncObservationCommand'];
export type SyncCreateManualTaskCommand = Schemas['SyncCreateManualTaskCommand'];
export type SyncEditTaskCommand = Schemas['SyncEditTaskCommand'];
export type SyncRescheduleTaskCommand = Schemas['SyncRescheduleTaskCommand'];
export type SyncCompleteTaskCommand = Schemas['SyncCompleteTaskCommand'];
export type SyncDismissTaskCommand = Schemas['SyncDismissTaskCommand'];
export type SyncSkipTaskCommand = Schemas['SyncSkipTaskCommand'];
export type SyncDeleteTaskCommand = Schemas['SyncDeleteTaskCommand'];
export type SyncAttachTaskFileCommand = Schemas['SyncAttachTaskFileCommand'];
export type SyncTaskCommand = Schemas['SyncTaskCommand'];
export type SyncGardenOperationPayload = Schemas['SyncGardenOperationPayload'];
export type SyncGardenObjectOperationPayload = Schemas['SyncGardenObjectOperationPayload'];
export type SyncPlantOperationPayload = Schemas['SyncPlantOperationPayload'];
export type SyncObservationOperationPayload = Schemas['SyncObservationOperationPayload'];
export type SyncTaskOperationPayload = Schemas['SyncTaskOperationPayload'];
export type SyncOperationPayload = Schemas['SyncOperationPayload'];
export type SyncMediaPrerequisite = Schemas['SyncMediaPrerequisite'];
export type SyncOperation = Schemas['SyncOperation'];
export type SyncPushRequest = Schemas['SyncPushRequest'];
export type SyncOperationError = Schemas['SyncOperationError'];
export type SyncAcceptedOperationResult = Schemas['SyncAcceptedOperationResult'];
export type SyncDuplicateOperationResult = Schemas['SyncDuplicateOperationResult'];
export type SyncConflictOperationResult = Schemas['SyncConflictOperationResult'];
export type SyncRejectedOperationResult = Schemas['SyncRejectedOperationResult'];
export type SyncBlockedByDependencyOperationResult =
  Schemas['SyncBlockedByDependencyOperationResult'];
export type SyncRetryLaterOperationResult = Schemas['SyncRetryLaterOperationResult'];
export type SyncPushOperationResult = Schemas['SyncPushOperationResult'];
export type SyncPushResult = Schemas['SyncPushResult'];
export type SyncUnknownOperationResult = Schemas['SyncUnknownOperationResult'];
export type SyncOperationLookupResult = Schemas['SyncOperationLookupResult'];
export type SyncAcknowledgeRequest = Schemas['SyncAcknowledgeRequest'];
export type SyncAcknowledgeResult = Schemas['SyncAcknowledgeResult'];
export type SyncClientPlatform = Schemas['SyncClientPlatform'];
export type SyncClientRegistrationRequest = Schemas['SyncClientRegistrationRequest'];
export type SyncClientInstallation = Schemas['SyncClientInstallation'];

/** The API base path. Breaking changes require a new major path. */
export const API_BASE_PATH = '/v1';

/** Header carrying the client-generated idempotency key on retryable mutations. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Header carrying the expected revision on revision-sensitive operations. */
export const IF_MATCH_HEADER = 'if-match';

/**
 * Error codes shared across modules.
 *
 * Module-specific codes live with their module. These are the ones the request
 * pipeline itself can produce, so every client must handle them regardless of
 * which endpoint it called.
 */
export const SharedErrorCode = {
  /** The request body or parameters failed contract validation. */
  RequestInvalid: 'request.invalid',
  /** Request or declared upload exceeds the permitted size. */
  RequestTooLarge: 'request.too_large',
  /** An idempotency key was reused with a different command. */
  IdempotencyKeyReused: 'request.idempotency.key_reused',
  /** Authentication credentials are missing or could not be verified. */
  Unauthenticated: 'auth.unauthenticated',
  /** The actor is authenticated but lacks the required capability. */
  Forbidden: 'auth.forbidden',
  /** The supplied revision precondition did not match the current revision. */
  StaleRevision: 'concurrency.stale_revision',
  /** A quota or rate limit was exceeded. */
  RateLimited: 'quota.rate_limited',
  /** An unexpected internal failure occurred. */
  Internal: 'server.internal',
  /** A required dependency is temporarily unavailable. */
  DependencyUnavailable: 'server.dependency_unavailable',
} as const;

export type SharedErrorCode = (typeof SharedErrorCode)[keyof typeof SharedErrorCode];

/**
 * Error codes the gardens-mapping module raises.
 *
 * Distinct from the generic `SharedErrorCode.StaleRevision` and would-be
 * generic "not found": a module-specific dotted code lets a client localize
 * "this garden was renamed by someone else" differently from an unrelated
 * concurrency conflict elsewhere in the product, matching the worked example
 * in the `Error` schema description (`garden.geometry.stale_revision`).
 */
export const GardenErrorCode = {
  /** No garden exists at this ID, or the caller has no membership on it. */
  NotFound: 'garden.not_found',
  /** The supplied `If-Match` revision no longer matches the stored garden. */
  StaleRevision: 'garden.stale_revision',
  /** The command does not apply to the garden's current lifecycle state. */
  LifecycleConflict: 'garden.lifecycle_conflict',
} as const;

export type GardenErrorCode = (typeof GardenErrorCode)[keyof typeof GardenErrorCode];

/**
 * Error codes the gardens-mapping module's map endpoints raise.
 *
 * `StaleRevision` is exactly the worked example the `Error` schema
 * description already names (`garden.geometry.stale_revision`) — this is
 * where that example was first put to use.
 */
export const MapErrorCode = {
  /** No object exists at this ID within this garden, or the garden itself is not visible to the caller. */
  NotFound: 'garden.geometry.object_not_found',
  /** The supplied `expectedRevision` no longer matches the object's stored revision. */
  StaleRevision: 'garden.geometry.stale_revision',
  /** The command does not apply to the object's current lifecycle state (for example, deleting an already-deleted object). */
  LifecycleConflict: 'garden.geometry.lifecycle_conflict',
} as const;

export type MapErrorCode = (typeof MapErrorCode)[keyof typeof MapErrorCode];

/**
 * Error codes the synchronization endpoints raise at the whole-request
 * level (`PushSyncOperations`, `GetSyncChanges`, `RegisterSyncClient`), as
 * opposed to a per-operation `SyncRejectedOperationResult.error.code`,
 * which is module-specific and not enumerated here.
 */
export const SyncErrorCode = {
  /** `protocolVersion` is outside the server's currently supported window. Does not imply the client's local outbox was lost. */
  ProtocolVersionUnsupported: 'sync.protocol_version.unsupported',
  /** `after` is older than the server's retained change history; a full resynchronization is required. */
  CursorExpired: 'sync.changes.cursor_expired',
} as const;

export type SyncErrorCode = (typeof SyncErrorCode)[keyof typeof SyncErrorCode];

/**
 * Error codes the media module's endpoints raise (P6-API-01).
 *
 * `UploadStateConflict` is deliberately distinct from
 * `media-lifecycle.ts`'s own internal `media.media_record.upload_state_conflict`
 * domain-layer code: the application layer checks `uploadState` itself
 * before ever calling a raw lifecycle transition function for
 * `CompleteMediaUpload`, so a client only ever sees this clean, contract-level
 * code, never the domain layer's own internal one — the same
 * "translate, do not leak internals" precedent
 * `translateCheckViolation` sets for raw database constraint violations.
 */
export const MediaErrorCode = {
  /** No media record exists at this ID, or it does not belong to the garden named in the path, or the caller lacks the capability to see it. */
  NotFound: 'media.not_found',
  /** The supplied `If-Match` revision no longer matches the stored media record. */
  StaleRevision: 'media.stale_revision',
  /** `CompleteMediaUpload` was called while the record is in an upload state it cannot verify from (for example, still `registered`, or already `deletion_scheduled`). */
  UploadStateConflict: 'media.upload_state_conflict',
  /** `GetMediaAccess` was called before the media reached `available`. */
  NotAvailable: 'media.not_available',
  /** The operational viewer role attempted to access `restricted`-classified media (section 12). */
  ViewerAccessRestricted: 'media.viewer_access_restricted',
  /** No `media.processing_job` row exists at the job ID a processing callback named (P6-ASYNC-01). */
  ProcessingJobNotFound: 'media.processing_job_not_found',
} as const;

export type MediaErrorCode = (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

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
   * Cloud Storage metadata as a content signature.
   */
  readonly validation: {
    readonly mediaClass: string;
    readonly displayFilename: string;
    readonly expectedContentType: string;
    readonly expectedByteSize: number;
  };
  /** Section 13: "Trace context." Propagated from the domain command that triggered this job, when known. */
  readonly traceId?: string;
}

/** One output object a processing job produced. */
export interface MediaProcessingOutputObject {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
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
}

/** Narrows an unknown response body to the shared error envelope. */
export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }

  const candidate = value.error;

  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'code' in candidate &&
    typeof candidate.code === 'string'
  );
}
