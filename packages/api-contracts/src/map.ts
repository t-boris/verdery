/**
 * The garden map's public contract types.
 *
 * Split out of `index.ts` for the repository's 600-line source-file limit,
 * the same posture `./garden-context.ts`, `./plants.ts` and their siblings
 * already take. `index.ts` re-exports this module in full, so nothing about
 * how a consumer imports these names changed.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

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
export type AerialObjectSourceMetadata = Schemas['AerialObjectSourceMetadata'];
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
/** ADR-0018 — what `readPlatFromPlan` answers: a reading, never a write. */
export type PlatReading = Schemas['PlatReading'];
export type PlatBoundary = Schemas['PlatBoundary'];
export type PlatBoundaryCall = Schemas['PlatBoundaryCall'];
export type ProposedPlatObject = Schemas['ProposedPlatObject'];
