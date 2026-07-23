/**
 * Public interface of the plants-inventory module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Two different audiences use this file:
 *
 * - `tasks-recommendations` (landing next) needs only `Plant` and enough of a
 *   query port — `PlantRepository.findById(plantId): Promise<Plant | null>`
 *   — to validate a task's `target_plant_id` references a real plant.
 *   Nothing else here is any of its concern.
 * - The composition root (`app.ts`) additionally needs the concrete classes
 *   below — every command class, the two Kysely repositories/writer/unit-of-
 *   work implementations, and `KyselyTaxonomyReferenceRepository` — to
 *   construct this module's dependency graph, the same way it already does
 *   for gardens-mapping and media.
 *
 * Deliberately absent this pass: a `CreateTaxonomyReference` command. This
 * table needs at least a read path for `AddPlant`'s caller to pick a
 * `taxonomyReferenceId` from — `SearchTaxonomyReferences` is that path — but
 * seeding/growing the catalog itself is a separate, later concern: the
 * migration's own comment on `plants_inventory.taxonomy_reference` already
 * distinguishes system-catalog rows (seeded independently of any profile)
 * from user-defined ones, and standing up a write path for the latter
 * without a seeded system catalog to check it against would be premature.
 * Tests seed rows directly.
 *
 * P4-CONTRACT-01 additionally lands this module's HTTP transport
 * (`registerPlantRoutes`, `PlantRoutesDependencies`) and one new read-only
 * query, `GetPlant` — see that class's own doc comment for why it was added
 * — against the `Plants` tag `packages/api-contracts/openapi.yaml` now
 * declares.
 *
 * P4-SEARCH-01 lands `SearchPlants` — a second new read-only query, closing
 * the "no way to list a garden's plants" gap `SearchPlants`'s own doc
 * comment explains in full — and upgrades `SearchTaxonomyReferences`'s
 * matching algorithm from a plain `ILIKE` substring test to `pg_trgm`
 * trigram similarity (see `kysely-taxonomy-reference-repository.ts`); that
 * command's own exported shape (`SearchTaxonomyReferences`,
 * `TaxonomyReferenceRepository`) is unchanged.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { Plant, PlantPlacement, PlantDetailsChanges } from './domain/plant.js';
export type { AcquisitionDateType, GroupingKind } from './domain/plant.js';
export type { LifecycleStage, PlantStatus } from './domain/plant-lifecycle.js';
export type { PlantPhoto } from './domain/plant-photo.js';
export type { PlantIdentification } from './domain/plant-identification.js';
export type { TaxonomyReference, TaxonomySource } from './domain/taxonomy-reference.js';

export type {
  PlantRepository,
  PlantSearchFilters,
  PlantSearchPage,
} from './application/plant-repository.js';
export type { PlantPhotoRepository } from './application/plant-photo-repository.js';
export type { PlantIdentificationRepository } from './application/plant-identification-repository.js';
export type { TaxonomyReferenceRepository } from './application/taxonomy-reference-repository.js';
export type {
  PlantRevisionJournalEntry,
  PlantRevisionJournalWriter,
  PlantCommandType,
} from './application/plant-revision-journal-writer.js';
export type {
  PlantsInventoryTransactionContext,
  PlantsInventoryUnitOfWork,
} from './application/plants-inventory-unit-of-work.js';
export { PlantErrorCode } from './application/plant-errors.js';
export type { PlantResource } from './application/plant-view.js';
export type { PlantPhotoResource } from './application/plant-photo-view.js';
export type { TaxonomyReferenceResource } from './application/taxonomy-reference-view.js';
export type { PhotoIdentificationSuggestion } from './application/identify-plant-from-photo.js';

export { AddPlant } from './application/add-plant.js';
export type { AddPlantInput } from './application/add-plant.js';
export { AddPlantFromPhoto } from './application/add-plant-from-photo.js';
export type { AddPlantFromPhotoInput } from './application/add-plant-from-photo.js';
export { AttachPlantPhoto } from './application/attach-plant-photo.js';
export type { AttachPlantPhotoInput } from './application/attach-plant-photo.js';
export { SetPrimaryPlantPhoto } from './application/set-primary-plant-photo.js';
export { UpdatePlantDetails } from './application/update-plant-details.js';
export { ConfirmPlantIdentification } from './application/confirm-plant-identification.js';
export { TransitionPlantLifecycleStage } from './application/transition-plant-lifecycle-stage.js';
export { SetPlantStatus } from './application/set-plant-status.js';
export { MovePlant } from './application/move-plant.js';
export type { MovePlantInput } from './application/move-plant.js';
export { SearchTaxonomyReferences } from './application/search-taxonomy-references.js';
export { GetPlant } from './application/get-plant.js';
export { SearchPlants } from './application/search-plants.js';
export type { SearchPlantsFilters, PlantSearchResult } from './application/search-plants.js';

export { registerPlantRoutes } from './transport/plant-routes.js';
export type { PlantRoutesDependencies } from './transport/plant-routes.js';

export { KyselyPlantRepository } from './persistence/kysely-plant-repository.js';
export { KyselyPlantPhotoRepository } from './persistence/kysely-plant-photo-repository.js';
export { KyselyPlantIdentificationRepository } from './persistence/kysely-plant-identification-repository.js';
export { KyselyTaxonomyReferenceRepository } from './persistence/kysely-taxonomy-reference-repository.js';
export { KyselyPlantRevisionJournalWriter } from './persistence/kysely-plant-revision-journal-writer.js';
export { KyselyPlantsInventoryUnitOfWork } from './persistence/kysely-plants-inventory-unit-of-work.js';
export type { PlantsInventoryDatabaseSchema } from './persistence/schema.js';
