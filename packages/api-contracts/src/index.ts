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
