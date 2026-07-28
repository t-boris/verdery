/**
 * The plants-inventory domain's contract surface (P4-CONTRACT-01,
 * ADR-0015) — the plant aggregate, its photo/identification/taxonomy
 * satellites, and every command request shape. Split out of `index.ts`
 * purely for the repository's 600-line source-file rule, the same posture
 * `garden-context.ts`/`organizations.ts` document for themselves;
 * `index.ts` re-exports everything here unchanged.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

export type PlantGroupingKind = Schemas['PlantGroupingKind'];
export type PlantAcquisitionDateType = Schemas['PlantAcquisitionDateType'];
export type PlantLifecycleStage = Schemas['PlantLifecycleStage'];
export type PlantStatus = Schemas['PlantStatus'];
export type TaxonomySource = Schemas['TaxonomySource'];
export type Plant = Schemas['Plant'];
export type PlantListResult = Schemas['PlantListResult'];
export type PlantPhoto = Schemas['PlantPhoto'];
export type PlantPhotoListResult = Schemas['PlantPhotoListResult'];
export type PlantIdentification = Schemas['PlantIdentification'];
/** `PlantIdentification.suggestedTaxonomy`, non-null — the openapi.yaml schema inlines this shape rather than naming a component for it (only this one field ever needs it), so it is derived here instead of duplicated. */
export type PlantIdentificationSuggestion = NonNullable<PlantIdentification['suggestedTaxonomy']>;
export type TaxonomyReference = Schemas['TaxonomyReference'];
export type TaxonomyReferenceListResult = Schemas['TaxonomyReferenceListResult'];
export type AddPlantRequest = Schemas['AddPlantRequest'];
export type AddPlantFromPhotoRequest = Schemas['AddPlantFromPhotoRequest'];
export type UpdatePlantDetailsRequest = Schemas['UpdatePlantDetailsRequest'];
export type AttachPlantPhotoRequest = Schemas['AttachPlantPhotoRequest'];
export type TransitionPlantLifecycleStageRequest = Schemas['TransitionPlantLifecycleStageRequest'];
export type SetPlantStatusRequest = Schemas['SetPlantStatusRequest'];
export type MovePlantRequest = Schemas['MovePlantRequest'];

/**
 * Error codes the plants-inventory module's identification endpoints raise
 * (ADR-0015). Mirrors `plants-inventory/application/plant-errors.ts`'s own
 * `PlantErrorCode` — that module has no landed contract-level error-code
 * export of its own yet (see that file's own doc comment), so only the one
 * code a client actually needs to distinguish — "nothing pending to
 * review" — is promoted here, the same narrow-promotion precedent
 * `CollaborationErrorCode.OwnershipTransferNotFound` set.
 */
export const PlantErrorCode = {
  /** No `plant_identification` row exists for this plant, or the one that does has already been confirmed — deliberately not distinguished, the same concealment posture `CollaborationErrorCode.OwnershipTransferNotFound` already applies. */
  IdentificationNotFound: 'plants_inventory.plant.identification_not_found',
} as const;

export type PlantErrorCode = (typeof PlantErrorCode)[keyof typeof PlantErrorCode];
