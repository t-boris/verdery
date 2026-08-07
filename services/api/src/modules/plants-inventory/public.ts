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
 * There is no general `CreateTaxonomyReference` command. The only write path
 * is the narrow photo-identification fallback that records a confident
 * scientific-name guess as `provider_sourced` when no reviewed catalog row
 * exists. It cannot create human-authored or system-catalog rows, and real
 * plants retain their explicit identification-confirmation boundary.
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

// Plant candidates and conversion (P11-DATA-01). HTTP transport
// (`registerCandidateRoutes`, tags `PlantCandidates`/`PlantCatalog`) and
// four read-only queries (`GetCandidate`, `ListCandidates`,
// `GetCandidateSuitability`, `GetTaxonProfile`) land in `P11-API-01`, the
// same staging this module's own P4-CONTRACT-01 precedent above followed.
export type {
  CandidateDetailsChanges,
  CandidatePlacement,
  CandidatePriority,
  CandidatePurchaseFacts,
  CandidateStatus,
  PlantCandidate,
} from './domain/plant-candidate.js';
export type { CandidateConversion } from './domain/candidate-conversion.js';
export type {
  CandidateListFilters,
  CandidateListPage,
  PlantCandidateRepository,
} from './application/plant-candidate-repository.js';
export type { CandidateConversionRepository } from './application/candidate-conversion-repository.js';
export { CandidateErrorCode } from './application/candidate-errors.js';
export type { CandidateResource } from './application/candidate-view.js';
export { toCandidateResource } from './application/candidate-view.js';
export { AddCandidate } from './application/add-candidate.js';
export type { AddCandidateInput } from './application/add-candidate.js';
export { AddCandidateFromPhoto } from './application/add-candidate-from-photo.js';
export type { AddCandidateFromPhotoInput } from './application/add-candidate-from-photo.js';
export { IdentifyCandidateFromPhoto } from './application/identify-candidate-from-photo.js';
export { UpdateCandidateDetails } from './application/update-candidate-details.js';
export { DeleteCandidate } from './application/delete-candidate.js';
export { SetCandidateStatus } from './application/set-candidate-status.js';
export { ConvertCandidate } from './application/convert-candidate.js';
export type {
  ConvertCandidateInput,
  ConvertCandidateResult,
  CandidateConversionResource,
} from './application/convert-candidate.js';
export { GetCandidate } from './application/get-candidate.js';
export { ListCandidates } from './application/list-candidates.js';
export type {
  ListCandidatesFilters,
  CandidateListResourcePage,
} from './application/list-candidates.js';
export { KyselyPlantCandidateRepository } from './persistence/kysely-plant-candidate-repository.js';
export { KyselyCandidateConversionRepository } from './persistence/kysely-candidate-conversion-repository.js';

// Candidate photos (P11-API-01) — mirrors the plant-photo exports
// below, retargeted to `plant_candidate`.
export type { PlantCandidatePhoto } from './domain/plant-candidate-photo.js';
export type { PlantCandidatePhotoRepository } from './application/plant-candidate-photo-repository.js';
export type { PlantCandidatePhotoResource } from './application/plant-candidate-photo-view.js';
export { ListCandidatePhotos } from './application/list-candidate-photos.js';
export { KyselyPlantCandidatePhotoRepository } from './persistence/kysely-plant-candidate-photo-repository.js';

// Taxon knowledge profile crosswalk and materialized version (P11-DATA-02).
// `plant_fact_assertion`/`plant_distribution_assertion`/`plant_media_asset`
// live in `integrations` (see that module's own public.ts) — this module
// owns the name crosswalk and the assembled profile that reads them.
export type { TaxonomyName, TaxonomyNameKind, TaxonomyNameSource } from './domain/taxonomy-name.js';
export { createTaxonomyName } from './domain/taxonomy-name.js';
export type {
  FactCandidate,
  PlantProfileVersion,
  ResolvedFact,
} from './domain/plant-profile-version.js';
export { assemblePlantProfileVersion } from './domain/plant-profile-version.js';
export type { PlantProfileVersionRepository } from './application/plant-profile-version-repository.js';
export { RebuildPlantProfileVersion } from './application/rebuild-plant-profile-version.js';
export type { RebuildPlantProfileVersionResult } from './application/rebuild-plant-profile-version.js';
export { KyselyTaxonImageSource } from './persistence/kysely-taxon-image-source.js';
export { KyselyPlantProfileVersionRepository } from './persistence/kysely-plant-profile-version-repository.js';
export { GetTaxonProfile } from './application/get-taxon-profile.js';

// Candidate suitability engine (P11-SUIT-01). Reachable over HTTP as of
// P11-API-01 (`GetCandidateSuitability`, `recalculateCandidateSuitability`
// route) — see `suitability-rule-catalog-instance.ts`'s own header for which
// design-doc axes have no rule yet and why.
export type {
  SuitabilityAssessmentResult,
  SuitabilityAxis,
  SuitabilityEvidence,
  SuitabilityFinding,
  SuitabilityUnknownReason,
} from './domain/suitability-finding.js';
export { findingsOfCategory, SUITABILITY_AXES } from './domain/suitability-finding.js';
export type {
  CandidateDistributionFact,
  CandidateProfileFact,
  CandidateSuitabilityFacts,
  GardenSuitabilityFacts,
} from './domain/suitability-facts.js';
export type {
  SuitabilityRuleDefinition,
  SuitabilityRuleEvaluator,
  SuitabilityRuleReviewMetadata,
} from './domain/suitability-rule-definition.js';
export { validateSuitabilityRuleDefinition } from './domain/suitability-rule-definition.js';
export { SuitabilityRuleCatalog } from './domain/suitability-rule-catalog.js';
export { createSuitabilityRuleCatalog } from './domain/suitability-rules/suitability-rule-catalog-instance.js';
export { evaluateCandidateSuitability } from './domain/evaluate-candidate-suitability.js';
export { RecalculateCandidateSuitability } from './application/recalculate-candidate-suitability.js';
export { GetCandidateSuitability } from './application/get-candidate-suitability.js';
export type { CandidateSuitabilityAssessmentRepository } from './application/candidate-suitability-assessment-repository.js';
export { KyselyCandidateSuitabilityAssessmentRepository } from './persistence/kysely-candidate-suitability-assessment-repository.js';

// Seasonal facts and bed-occupancy history (P9D-SEASON-DATA-01). Exported
// narrowly — the read ports and the domain provenance shape, no HTTP
// transport, the same "export a narrow read port, don't build the consumer
// yet" discipline `GardenContextFactRepository`/`ListGardenContextFacts`
// already established for gardens-mapping's sibling table. Stage 2
// (P9D-SEASON-RULES-01, a separate later work package) is the consumer.
export type {
  Hemisphere,
  TaxonomySeasonalAuthoring,
  TaxonomySeasonalAuthoringCandidate,
  TaxonomySeasonalAuthoringMethod,
  TaxonomySeasonalFact,
  TaxonomySeasonalFactProvenance,
  TaxonomySeasonalFactProvenanceCandidate,
  TaxonomySeasonalReview,
  TaxonomySeasonalReviewCandidate,
  TaxonomySeasonalReviewStatus,
  TaxonomySeasonalTiming,
} from './domain/taxonomy-seasonal-fact.js';
export {
  HEMISPHERES,
  validateTaxonomySeasonalAuthoring,
  validateTaxonomySeasonalFactProvenance,
  validateTaxonomySeasonalReview,
} from './domain/taxonomy-seasonal-fact.js';
export type { TaxonomySeasonalFactRepository } from './application/taxonomy-seasonal-fact-repository.js';
export { KyselyTaxonomySeasonalFactRepository } from './persistence/kysely-taxonomy-seasonal-fact-repository.js';
export type {
  BedOccupancyHistoryReader,
  BedOccupancyPeriod,
} from './application/bed-occupancy-history.js';
export { KyselyBedOccupancyHistoryReader } from './persistence/kysely-bed-occupancy-history-reader.js';

export type {
  PlantRepository,
  PlantSearchFilters,
  PlantSearchPage,
} from './application/plant-repository.js';
export { NO_PLANT_SEARCH_FILTERS } from './application/plant-repository.js';
export type { PlantPhotoRepository } from './application/plant-photo-repository.js';
export type { PlantIdentificationRepository } from './application/plant-identification-repository.js';
export type {
  TaxonomyNameMatch,
  TaxonomyReferenceRepository,
  TaxonomySearchResult,
} from './application/taxonomy-reference-repository.js';
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
// `toPlantResource` itself (not only its type) is exported for P9C-EXPORT-01:
// the client-export manifest reuses this exact mapping for its own "accepted
// garden model" section rather than a second copy — see that command's own
// header.
export { toPlantResource } from './application/plant-view.js';
export type { PlantPhotoResource } from './application/plant-photo-view.js';
export type { PlantIdentificationResource } from './application/plant-identification-view.js';
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
export { RecordObservationFromIdentification } from './application/record-observation-from-identification.js';
export { TransitionPlantLifecycleStage } from './application/transition-plant-lifecycle-stage.js';
export { SetPlantStatus } from './application/set-plant-status.js';
export { MovePlant } from './application/move-plant.js';
export type { MovePlantInput } from './application/move-plant.js';
export { SearchTaxonomyReferences } from './application/search-taxonomy-references.js';
export { GetPlant } from './application/get-plant.js';
export { GetPlantIdentification } from './application/get-plant-identification.js';
export { ListPlantPhotos } from './application/list-plant-photos.js';
export { SearchPlants } from './application/search-plants.js';
export type { SearchPlantsFilters, PlantSearchResult } from './application/search-plants.js';

export { registerPlantRoutes } from './transport/plant-routes.js';
export type { PlantRoutesDependencies } from './transport/plant-routes.js';
export { registerCandidateRoutes } from './transport/candidate-routes.js';
export type { CandidateRoutesDependencies } from './transport/candidate-routes.js';

export { KyselyPlantRepository } from './persistence/kysely-plant-repository.js';
export { KyselyPlantPhotoRepository } from './persistence/kysely-plant-photo-repository.js';
export { KyselyPlantIdentificationRepository } from './persistence/kysely-plant-identification-repository.js';
export { KyselyTaxonomyReferenceRepository } from './persistence/kysely-taxonomy-reference-repository.js';
export { KyselyPlantRevisionJournalWriter } from './persistence/kysely-plant-revision-journal-writer.js';
export { KyselyPlantsInventoryUnitOfWork } from './persistence/kysely-plants-inventory-unit-of-work.js';
export type { PlantsInventoryDatabaseSchema } from './persistence/schema.js';
