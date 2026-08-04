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
export type GeoreferenceMethod = Schemas['GeoreferenceMethod'];
export type SetGardenGeoreferenceRequest = Schemas['SetGardenGeoreferenceRequest'];
export type AddressPrecision = Schemas['AddressPrecision'];
export type AddressCandidate = Schemas['AddressCandidate'];
export type AddressCandidateListResult = Schemas['AddressCandidateListResult'];
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

/** The garden context facts schemas (P9D-CONTEXT-01) live in `./garden-context.js` — same 600-line-rule posture as `./organizations.js` above. */
export * from './garden-context.js';

/** The plants-inventory schemas (P4-CONTRACT-01) live in `./plants.js` — same 600-line-rule posture as `./garden-context.js` above. */
export * from './plants.js';

/** The plant-candidate/conversion/suitability/taxon-profile schemas (P11-API-01) live in `./plant-candidates.js` — same 600-line-rule posture. */
export * from './plant-candidates.js';

/** The observations-history schemas (P4-CONTRACT-01, P11-MEDIA-01, P11-HEALTH-01) live in `./observations.js` — same 600-line-rule posture as `./plants.js`. */
export * from './observations.js';

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

/** The task assignment and shared activity history schemas (P9A-TASK-01). */
export type AssignTaskRequest = Schemas['AssignTaskRequest'];
export type TaskActivityEntry = Schemas['TaskActivityEntry'];
export type TaskActivityListResult = Schemas['TaskActivityListResult'];

/** The Today view and recommendation schemas (P7-BE-01). */
export type RecommendationState = Schemas['RecommendationState'];
export type RecommendationSafetyTier = Schemas['RecommendationSafetyTier'];
export type RecommendationEvidenceKind = Schemas['RecommendationEvidenceKind'];
export type RecommendationPriorityFactorKind = Schemas['RecommendationPriorityFactorKind'];
export type RecommendationPriorityFactor = Schemas['RecommendationPriorityFactor'];
export type RecommendationEvidence = Schemas['RecommendationEvidence'];
export type Recommendation = Schemas['Recommendation'];
export type TodayRecommendation = Schemas['TodayRecommendation'];
export type TodayResult = Schemas['TodayResult'];
export type PostponeRecommendationRequest = Schemas['PostponeRecommendationRequest'];
export type ConvertRecommendationToTaskResult = Schemas['ConvertRecommendationToTaskResult'];

/** The seasonal plan schemas (P9D-SEASON-API-01) live in `./seasonal-plan.js` — same 600-line-rule posture as `./garden-context.js` above. */
export * from './seasonal-plan.js';

/** The media schemas (P6-API-01). */
export type MediaClass = Schemas['MediaClass'];
export type MediaUploadState = Schemas['MediaUploadState'];
export type MediaProcessingState = Schemas['MediaProcessingState'];
export type MediaSensitivityClassification = Schemas['MediaSensitivityClassification'];
export type Media = Schemas['Media'];
export type RegisterMediaUploadRequest = Schemas['RegisterMediaUploadRequest'];
export type MediaUploadSession = Schemas['MediaUploadSession'];
export type MediaAccess = Schemas['MediaAccess'];
/** The media listing and derivative-resolution schemas (P6-PLAN-01). */
export type MediaDerivativeKindSummary = Schemas['MediaDerivativeKindSummary'];
export type MediaDerivativeSummary = Schemas['MediaDerivativeSummary'];
export type MediaListResult = Schemas['MediaListResult'];
/** The retention-policy schemas (P6-RET-01). */
export type MediaRetentionAnchor = Schemas['MediaRetentionAnchor'];
export type MediaClassRetentionPolicy = Schemas['MediaClassRetentionPolicy'];
export type MediaRetentionPolicyResult = Schemas['MediaRetentionPolicyResult'];

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

/** The notification inbox and preference schemas (P7-NOTIF-01). */
export type NotificationType = Schemas['NotificationType'];
export type NotificationPriority = Schemas['NotificationPriority'];
export type NotificationDeepLink = Schemas['NotificationDeepLink'];
export type Notification = Schemas['Notification'];
export type NotificationListResult = Schemas['NotificationListResult'];
export type NotificationQuietHours = Schemas['NotificationQuietHours'];
export type NotificationPreferenceEntry = Schemas['NotificationPreferenceEntry'];
export type NotificationPreferencesDocument = Schemas['NotificationPreferencesDocument'];
export type UpdateNotificationPreferencesRequest = Schemas['UpdateNotificationPreferencesRequest'];
export type NotificationDevicePlatform = Schemas['NotificationDevicePlatform'];
export type RegisterNotificationDeviceRequest = Schemas['RegisterNotificationDeviceRequest'];
export type NotificationDevice = Schemas['NotificationDevice'];

/** The data-export request schemas (P8-EXPORT-01). */
export type ExportScope = Schemas['ExportScope'];
export type ExportRequestState = Schemas['ExportRequestState'];
export type CreateExportRequest = Schemas['CreateExportRequest'];
export type ExportRequest = Schemas['ExportRequest'];

/** The collaboration membership and invitation schemas (P9A-API-01). */
export type GardenMemberState = Schemas['GardenMemberState'];
export type GardenMember = Schemas['GardenMember'];
export type GardenMemberListResult = Schemas['GardenMemberListResult'];
export type ChangeGardenMemberRoleRequest = Schemas['ChangeGardenMemberRoleRequest'];
export type InvitationIntendedRole = Schemas['InvitationIntendedRole'];
export type InvitationState = Schemas['InvitationState'];
export type Invitation = Schemas['Invitation'];
export type InvitationListResult = Schemas['InvitationListResult'];
export type CreateInvitationResult = Schemas['CreateInvitationResult'];
export type CreateInvitationRequest = Schemas['CreateInvitationRequest'];
export type AcceptInvitationRequest = Schemas['AcceptInvitationRequest'];

/** The professional-service domain schemas/error codes (P9B-API-01) live in `./organizations.js` — split out purely for the 600-line source-file rule; still part of this package's one public surface, re-exported unchanged. */
export * from './organizations.js';
/** The client-publication domain schemas/error codes (P9C-PUBLISH-01) live in `./publications.js` — same 600-line-rule posture as `./organizations.js` above. */
export * from './publications.js';
/** The client-invitation/access-grant schemas/error codes (P9C-INVITE-01) live in `./client-invitations.js`, and the `client_update.published` notification-event contract in `./client-publication-events.js` — same 600-line-rule posture. */
export * from './client-invitations.js';
export * from './client-publication-events.js';
/** The client-portal read-only domain schemas/error codes (P9C-API-01) live in `./client-portal.js` — same 600-line-rule posture as `./client-invitations.js` above. */
export * from './client-portal.js';

/** The ownership-administration schemas (P9A-OWNER-01): promote, demote, transfer, cancel. */
export type OwnershipTransferState = Schemas['OwnershipTransferState'];
export type OwnershipTransfer = Schemas['OwnershipTransfer'];
export type TransferOwnershipRequest = Schemas['TransferOwnershipRequest'];
/** The ownership-transfer read schemas (P9A-OWNER-02): the garden-scoped and profile-scoped reads. */
export type IncomingOwnershipTransfer = Schemas['IncomingOwnershipTransfer'];
export type IncomingOwnershipTransferListResult = Schemas['IncomingOwnershipTransferListResult'];

/** The account-deletion schemas (P8-DELETE-01). */
export type AccountDeletionState = Schemas['AccountDeletionState'];
export type AccountDeletionGardenResolution = Schemas['AccountDeletionGardenResolution'];
export type AccountDeletionGarden = Schemas['AccountDeletionGarden'];
export type AccountDeletion = Schemas['AccountDeletion'];

/** The API base path. Breaking changes require a new major path. */
export const API_BASE_PATH = '/v1';

/** Header carrying the client-generated idempotency key on retryable mutations. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Header carrying the expected revision on revision-sensitive operations. */
export const IF_MATCH_HEADER = 'if-match';

/**
 * Largest photo the species-identification provider will look at, in bytes.
 *
 * 30 MiB, and not a guess: on 2026-08-04 a 32,282,247-byte PNG produced
 * `400 INVALID_ARGUMENT` from Vertex AI reading
 * "exceeds max allowed file size of 31457280 for `image/png` files", and the
 * whole failure reached the person as a candidate with no species and no
 * explanation.
 *
 * Shared rather than duplicated: the API refuses to spend a provider call
 * above this, and the web says so before the upload starts. Two copies of
 * this number would drift, and the drift would be invisible until someone's
 * photograph silently stopped being identified.
 *
 * A larger photo still uploads and still attaches — only the identification
 * is skipped.
 */
export const IDENTIFIABLE_PHOTO_MAX_BYTES = 31_457_280;

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

/** `PlantErrorCode` (ADR-0015) lives in `./plants.js` alongside the rest of the plants-inventory contract surface — same 600-line-rule posture as `./garden-context.js` above. */

/** The synchronization endpoints' whole-request error codes (`SyncErrorCode`) live in `./sync-contracts.js` — same 600-line-rule posture as `./organizations.js` above. */
export * from './sync-contracts.js';

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
  /** `CompleteMediaUpload` or `DeleteGardenMedia` was called while the record is in an upload state that command cannot proceed from (for example, completing a record still `registered`, or deleting one still `uploading`). */
  UploadStateConflict: 'media.upload_state_conflict',
  /** `GetMediaAccess` was called before the media reached `available`. */
  NotAvailable: 'media.not_available',
  /** The operational viewer role attempted to access `restricted`-classified media (section 12). */
  ViewerAccessRestricted: 'media.viewer_access_restricted',
  /** No `media.processing_job` row exists at the job ID a processing callback named (P6-ASYNC-01). */
  ProcessingJobNotFound: 'media.processing_job_not_found',
  /** `DeleteGardenMedia` named a record still referenced by an attachment row — a plant photo, observation photo, task attachment, or imported-background map object (P6-RET-01). One detail entry names each referencing kind. */
  Referenced: 'media.referenced',
  /** `DeleteGardenMedia` named a derivative row directly — a derivative is deleted with its source, never independently (P6-RET-01). */
  DerivativeNotDeletable: 'media.derivative_not_deletable',
} as const;

export type MediaErrorCode = (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

/**
 * The media processing/deletion machine-to-machine contract (event types,
 * payloads, manifest, result) lives in `./media-processing.js` — split out
 * of this file purely for the repository's 600-line source-file rule once
 * P6-RET-01 grew it past the limit; still part of this package's one public
 * surface, re-exported here unchanged.
 */
export * from './media-processing.js';

/**
 * The recommendation-candidate outbox event contract (P7-ASYNC-01) lives in
 * `./recommendation-events.js` — the same hand-written machine-to-machine
 * posture as `./media-processing.js`, re-exported here unchanged.
 */
export * from './recommendation-events.js';

/**
 * The relay-to-API notification event dispatch contract (P7-NOTIF-01) lives
 * in `./notification-dispatch.js` — the same hand-written machine-to-machine
 * posture as `./media-processing.js`, re-exported here unchanged.
 */
export * from './notification-dispatch.js';

/**
 * The task-assignment outbox event contract (P9A-TASK-01) lives in
 * `./task-events.js` — the same hand-written machine-to-machine posture as
 * `./recommendation-events.js`, re-exported here unchanged.
 */
export * from './task-events.js';

/**
 * Error codes the notifications module raises (P7-NOTIF-01).
 *
 * The inbox commands conceal non-ownership as not-found (a caller must not
 * learn that someone else's notification id exists), the same posture
 * `GardenErrorCode.NotFound` documents for gardens.
 */
export const NotificationErrorCode = {
  /** No notification exists at this ID, or it does not belong to the caller. */
  NotFound: 'notification.not_found',
  /** The supplied `If-Match` revision no longer matches the stored preference document. */
  PreferencesStaleRevision: 'notification.preferences_stale_revision',
} as const;

export type NotificationErrorCode =
  (typeof NotificationErrorCode)[keyof typeof NotificationErrorCode];

/**
 * The export-generation machine-to-machine contract (P8-EXPORT-01) lives
 * in `./export-processing.js` — the same hand-written posture as
 * `./media-processing.js`, re-exported here unchanged.
 */
export * from './export-processing.js';

/**
 * Error codes the exports module raises (P8-EXPORT-01).
 *
 * Non-ownership is concealed as not-found (a caller must not learn that
 * someone else's export request id exists), the same posture
 * `NotificationErrorCode.NotFound` documents for inbox entries.
 */
export const ExportErrorCode = {
  /** No export request exists at this ID, or it does not belong to the caller. */
  NotFound: 'export.not_found',
  /** The caller already has an export in `requested` or `running` state — one active export per requester (data-export-and-deletion.md section 6's "expensive" posture, enforced by a partial unique index). */
  ActiveExportExists: 'export.active_export_exists',
  /** Account-wide export requires a recent sign-in (section 5: "Recent authentication is required for account-wide export"); the session's `auth_time` is too old. */
  RecentAuthenticationRequired: 'export.recent_authentication_required',
  /** `GetExportDownload` was called before the package completed, after it expired, or after its package left the `available` state. */
  NotDownloadable: 'export.not_downloadable',
} as const;

export type ExportErrorCode = (typeof ExportErrorCode)[keyof typeof ExportErrorCode];

/**
 * Error codes the deletion surface raises (P8-DELETE-01) — shared by garden
 * deletion (`requestGardenDeletion`, `restoreGarden`) and account deletion
 * (`requestAccountDeletion`, `restoreAccount`, `getAccountDeletion`), because
 * both halves enforce exactly the same three rules: a recent sign-in, a state
 * a request or a restore can actually proceed from, and the point of no
 * return once a purge has been claimed.
 */
export const DeletionErrorCode = {
  /** Deletion and restore require a recent sign-in (architecture/data-export-and-deletion.md sections 10.1 and 11); the session's `auth_time` is too old. */
  RecentAuthenticationRequired: 'deletion.recent_authentication_required',
  /** No deletion is pending for the caller's account. */
  NotFound: 'deletion.not_found',
  /** A deletion is already pending for this subject. */
  AlreadyRequested: 'deletion.already_requested',
  /** The recovery window is over: the purge has been claimed and the subject can never return to active (section 16). */
  NotRecoverable: 'deletion.not_recoverable',
} as const;

export type DeletionErrorCode = (typeof DeletionErrorCode)[keyof typeof DeletionErrorCode];

/**
 * Error codes the collaboration membership and invitation endpoints raise
 * (P9A-API-01).
 *
 * Membership non-existence is concealed as `notFound` exactly like
 * `GardenErrorCode.NotFound` does for a garden a caller cannot see — a
 * caller who cannot see a garden must not learn who its members are either,
 * and a target profile with no active membership looks identical to one
 * that was never a member. Invitation lookups by token key on the token's
 * own secrecy rather than membership: a caller who already possesses the
 * token has already proven they received a real invitation, so its
 * `notFound`/`expired`/`revoked`/`alreadyAccepted` codes are ordinary domain
 * states, not a concealment device — see architecture/identity-and-
 * authorization.md, section "10. Invitations".
 */
export const CollaborationErrorCode = {
  /** No ACTIVE membership exists at this profile on this garden, or the caller lacks visibility into it. */
  MembershipNotFound: 'collaboration.membership.not_found',
  /** The command would leave the garden with no active owner (section "11. Ownership Transfer": "a garden must always have at least one owner unless it is in a deletion workflow"). */
  LastOwnerRequired: 'collaboration.membership.last_owner_required',
  /** `changeMemberRole` was asked to move a role into or out of `owner` — out of scope for this endpoint; owner transitions are a dedicated, recent-auth-gated flow. */
  OwnerRoleNotAllowed: 'collaboration.membership.owner_role_not_allowed',
  /** No invitation exists at this token, or the token is malformed. Never distinguished from a genuinely unknown token. */
  InvitationNotFound: 'collaboration.invitation.not_found',
  /** A PENDING invitation already exists for this garden and intended email (the partial unique index's application-level mirror). */
  InvitationAlreadyPending: 'collaboration.invitation.already_pending',
  /** The invitation's `expiresAt` has passed. Evaluated at acceptance time regardless of whether the expiry sweep has already run. */
  InvitationExpired: 'collaboration.invitation.expired',
  /** The invitation was revoked before it was accepted. */
  InvitationRevoked: 'collaboration.invitation.revoked',
  /** The invitation was already accepted — by this caller (replayed outside the idempotency window) or another. */
  InvitationAlreadyAccepted: 'collaboration.invitation.already_accepted',
  /** The invitation is bound to an email address that does not match the accepting caller's own verified email. */
  InvitationEmailMismatch: 'collaboration.invitation.email_mismatch',
  /**
   * Promotion, demotion, and ownership transfer require the acting owner's
   * session `auth_time` to be recent (P9A-OWNER-01, matrix rows H8/H9/H13:
   * "recent auth ≤ 30 m"); it is too old. A domain-local code rather than a
   * reuse of `DeletionErrorCode.RecentAuthenticationRequired` — this
   * codebase's established posture of one error code per sensitive-action
   * family, matching `ExportErrorCode.RecentAuthenticationRequired`'s own
   * precedent alongside deletion's.
   */
  RecentAuthenticationRequired: 'collaboration.membership.recent_authentication_required',
  /** `demoteOwner` was asked to demote a target whose CURRENT role is not `owner`. Also reused by `acceptOwnershipTransfer`'s re-validation of the transfer's `from_profile_id` at acceptance time — the identical fact, just re-read later by the recipient instead of the initiator. */
  TargetNotOwner: 'collaboration.membership.target_not_owner',
  /** `transferOwnership` named a target who already holds `owner` — demoting the existing co-owner set is `demoteOwner`'s job instead. Also reused by `acceptOwnershipTransfer`'s re-validation of the caller's own membership (a concurrent `promoteGardenMember` could have made them co-owner already while the transfer stayed pending). */
  TargetAlreadyOwner: 'collaboration.membership.target_already_owner',
  /** A PENDING ownership transfer already exists for this garden (`ownership_transfer_pending_key`'s application-level mirror, and the genuine concurrent race the mirror cannot see). */
  OwnershipTransferAlreadyPending: 'collaboration.ownership_transfer.already_pending',
  /** No PENDING ownership transfer exists for this garden addressed to the caller — reused identically by `cancelGardenOwnershipTransfer`, `acceptOwnershipTransfer`, and `declineOwnershipTransfer` (not pending at all, or pending for someone else — deliberately not distinguished, the same concealment posture `MembershipNotFound` already applies). */
  OwnershipTransferNotFound: 'collaboration.ownership_transfer.not_found',
} as const;

export type CollaborationErrorCode =
  (typeof CollaborationErrorCode)[keyof typeof CollaborationErrorCode];

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
