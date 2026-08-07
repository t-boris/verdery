/**
 * Composition-root helper for the plants-inventory module: the plant
 * aggregate's commands and queries plus the read-only taxonomy catalog.
 * Split out of `app.ts` for the same 600-line reason as its sibling
 * `compose-*.ts` files — the composition root grew past the limit when
 * P8-DELETE-01 added the deletion module and its own encapsulation context.
 * Still composition-root code, not a module boundary.
 *
 * Reuses `gardenAuthorization` exactly as `app.ts` did; nothing about the
 * dependency graph changed in the move.
 */

import {
  ApproveTaxonomySeasonalFactReview,
  KyselyTaxonomySeasonalFactRepository,
  ListTaxonomySeasonalFactsAwaitingReview,
  AddCandidate,
  AddCandidateFromPhoto,
  AddPlant,
  AddPlantFromPhoto,
  AttachPlantPhoto,
  ConfirmPlantIdentification,
  ConvertCandidate,
  createSuitabilityRuleCatalog,
  GetCandidate,
  GetCandidateSuitability,
  GetPlant,
  GetPlantIdentification,
  GetTaxonProfile,
  IdentifyCandidateFromPhoto,
  KyselyCandidateSuitabilityAssessmentRepository,
  KyselyPlantCandidatePhotoRepository,
  KyselyPlantCandidateRepository,
  KyselyPlantIdentificationRepository,
  KyselyPlantPhotoRepository,
  KyselyPlantProfileVersionRepository,
  KyselyTaxonImageSource,
  KyselyPlantRepository,
  KyselyPlantsInventoryUnitOfWork,
  KyselyTaxonomyReferenceRepository,
  ListCandidatePhotos,
  ListCandidates,
  ListPlantPhotos,
  MovePlant,
  RecalculateCandidateSuitability,
  RecordObservationFromIdentification,
  SearchPlants,
  SearchTaxonomyReferences,
  DeleteCandidate,
  SetCandidateStatus,
  SetPlantStatus,
  SetPrimaryPlantPhoto,
  TransitionPlantLifecycleStage,
  UpdateCandidateDetails,
  UpdatePlantDetails,
  type TaxonProfileEnricher,
} from './modules/plants-inventory/public.js';
import type {
  SeasonalFactReviewRoutesDependencies,
  CandidateRoutesDependencies,
  PlantRoutesDependencies,
} from './modules/plants-inventory/public.js';
import type { FastifyBaseLogger } from 'fastify';
import {
  KyselyGardenContextFactRepository,
  type GardenAuthorization,
} from './modules/gardens-mapping/public.js';
import {
  KyselyPlantDistributionAssertionRepository,
  KyselyPlantTaxonomyMappingRepository,
  type AnalyzePlantCondition,
  type IdentifyPlantSpecies,
} from './modules/integrations/public.js';
import type { RecordObservation } from './modules/observations-history/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from './shared/identifiers/uuid.js';
import type { Clock } from './shared/time/clock.js';

/**
 * Tie-break ordering `RecalculateCandidateSuitability`'s `pickWinner`-style
 * conflict resolution consults when more than one `horticulturally_reviewed`
 * source covers the same fact — deliberately empty today. ADR-0013/ADR-0016
 * already selected a source per knowledge class (World Flora Online, USDA
 * PLANTS, USDA Characteristics, Wikidata, GBIF, USA-NPN, USDA NRCS, USDA
 * APHIS), but zero adapters are registered in any environment yet
 * (`P11-ASYNC-01` builds them) — the same honest "no provider configured"
 * state `RefreshPlantContentConfiguration.activeProviderKey: null` already
 * carries for text content. An empty list is not a stub: every provider
 * absent from it still resolves deterministically via confidence, then
 * freshness, then alphabetical order (`plant-profile-version.ts`'s own
 * `pickWinner`) — this becomes a real, non-empty, ADR-ordered list once
 * `P11-ASYNC-01` registers real provider keys.
 */
const PLANT_KNOWLEDGE_SOURCE_PRIORITY: readonly string[] = [];

export function composePlantsInventory(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  identifyPlantSpecies: IdentifyPlantSpecies,
  logger: FastifyBaseLogger,
  analyzePlantCondition: AnalyzePlantCondition,
  recordObservation: RecordObservation,
  taxonProfileEnricher: TaxonProfileEnricher,
  /** The same reviewer allowlist the plant-assertion queue uses — "reviewer" is one role in this system, not two. */
  reviewerEmails: readonly string[],
): {
  plantRoutesDependencies: PlantRoutesDependencies;
  candidateRoutesDependencies: CandidateRoutesDependencies;
  seasonalFactReviewRoutesDependencies: SeasonalFactReviewRoutesDependencies;
} {
  const plantRepository = new KyselyPlantRepository(database.queries);
  const taxonomyReferenceRepository = new KyselyTaxonomyReferenceRepository(database.queries);
  const plantsInventoryIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const plantsInventoryUnitOfWork = new KyselyPlantsInventoryUnitOfWork(database.queries, clock);
  const addPlant = new AddPlant(
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const addPlantFromPhoto = new AddPlantFromPhoto(
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
    identifyPlantSpecies,
    taxonomyReferenceRepository,
    logger,
    analyzePlantCondition,
  );
  const getPlant = new GetPlant(plantRepository, gardenAuthorization);
  const plantIdentificationRepository = new KyselyPlantIdentificationRepository(database.queries);
  const getPlantIdentification = new GetPlantIdentification(
    plantRepository,
    plantIdentificationRepository,
    taxonomyReferenceRepository,
    gardenAuthorization,
  );
  const plantPhotoRepository = new KyselyPlantPhotoRepository(database.queries);
  const listPlantPhotos = new ListPlantPhotos(
    plantRepository,
    plantPhotoRepository,
    gardenAuthorization,
  );
  const searchPlants = new SearchPlants(plantRepository, gardenAuthorization, plantPhotoRepository);
  const attachPlantPhoto = new AttachPlantPhoto(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const setPrimaryPlantPhoto = new SetPrimaryPlantPhoto(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
  );
  const updatePlantDetails = new UpdatePlantDetails(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const confirmPlantIdentification = new ConfirmPlantIdentification(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
    taxonomyReferenceRepository,
  );
  const transitionPlantLifecycleStage = new TransitionPlantLifecycleStage(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const setPlantStatus = new SetPlantStatus(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const movePlant = new MovePlant(
    plantRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const searchTaxonomyReferences = new SearchTaxonomyReferences(taxonomyReferenceRepository);
  const recordObservationFromIdentification = new RecordObservationFromIdentification(
    plantRepository,
    plantIdentificationRepository,
    gardenAuthorization,
    recordObservation,
  );

  // Plant candidates, conversion, suitability, and the taxon knowledge
  // profile (P11-DATA-01/02, P11-SUIT-01) reach HTTP here for the first
  // time (P11-API-01). `plantCandidateRepository` is shared outside the
  // unit-of-work by every read/status-guarded command, the same way
  // `plantRepository` already is above.
  const plantCandidateRepository = new KyselyPlantCandidateRepository(database.queries);
  const addCandidate = new AddCandidate(
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const addCandidateFromPhoto = new AddCandidateFromPhoto(
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
    identifyPlantSpecies,
    taxonomyReferenceRepository,
    logger,
    analyzePlantCondition,
  );
  const plantCandidatePhotoRepository = new KyselyPlantCandidatePhotoRepository(database.queries);
  const listCandidatePhotos = new ListCandidatePhotos(
    plantCandidateRepository,
    plantCandidatePhotoRepository,
    gardenAuthorization,
  );
  const identifyCandidateFromPhoto = new IdentifyCandidateFromPhoto(
    plantCandidateRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
    identifyPlantSpecies,
    taxonomyReferenceRepository,
    logger,
    analyzePlantCondition,
  );
  const listCandidates = new ListCandidates(plantCandidateRepository, gardenAuthorization);
  const getCandidate = new GetCandidate(plantCandidateRepository, gardenAuthorization);
  const updateCandidateDetails = new UpdateCandidateDetails(
    plantCandidateRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const setCandidateStatus = new SetCandidateStatus(
    plantCandidateRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );
  const deleteCandidate = new DeleteCandidate(
    plantCandidateRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
  );
  const convertCandidate = new ConvertCandidate(
    plantCandidateRepository,
    plantsInventoryIdempotency,
    plantsInventoryUnitOfWork,
    gardenAuthorization,
    clock,
  );

  const gardenContextFactRepository = new KyselyGardenContextFactRepository(database.queries);
  const plantProfileVersionRepository = new KyselyPlantProfileVersionRepository(database.queries);
  const plantTaxonomyMappingRepository = new KyselyPlantTaxonomyMappingRepository(database.queries);
  const plantDistributionAssertionRepository = new KyselyPlantDistributionAssertionRepository(
    database.queries,
  );
  const candidateSuitabilityAssessmentRepository =
    new KyselyCandidateSuitabilityAssessmentRepository(database.queries);
  const getCandidateSuitability = new GetCandidateSuitability(
    plantCandidateRepository,
    candidateSuitabilityAssessmentRepository,
    gardenAuthorization,
  );
  const recalculateCandidateSuitability = new RecalculateCandidateSuitability(
    plantCandidateRepository,
    gardenContextFactRepository,
    plantProfileVersionRepository,
    plantTaxonomyMappingRepository,
    plantDistributionAssertionRepository,
    candidateSuitabilityAssessmentRepository,
    createSuitabilityRuleCatalog(),
    gardenAuthorization,
    generateUuidV7,
    PLANT_KNOWLEDGE_SOURCE_PRIORITY,
  );
  const getTaxonProfile = new GetTaxonProfile(
    taxonomyReferenceRepository,
    plantProfileVersionRepository,
    new KyselyTaxonImageSource(database.queries),
    taxonProfileEnricher,
  );

  // The seasonal-timing review queue and its sign-off. Its own read-only
  // adapter bound to the pooled connection — a reviewer's queue read and a
  // single guarded update need no transaction of their own.
  const seasonalFacts = new KyselyTaxonomySeasonalFactRepository(database.queries);

  return {
    seasonalFactReviewRoutesDependencies: {
      listTaxonomySeasonalFactsAwaitingReview: new ListTaxonomySeasonalFactsAwaitingReview(
        seasonalFacts,
        reviewerEmails,
      ),
      approveTaxonomySeasonalFactReview: new ApproveTaxonomySeasonalFactReview(
        seasonalFacts,
        reviewerEmails,
        clock,
      ),
    },
    plantRoutesDependencies: {
      addPlant,
      addPlantFromPhoto,
      getPlant,
      getPlantIdentification,
      listPlantPhotos,
      searchPlants,
      updatePlantDetails,
      attachPlantPhoto,
      setPrimaryPlantPhoto,
      confirmPlantIdentification,
      recordObservationFromIdentification,
      transitionPlantLifecycleStage,
      setPlantStatus,
      movePlant,
      searchTaxonomyReferences,
    },
    candidateRoutesDependencies: {
      addCandidate,
      addCandidateFromPhoto,
      identifyCandidateFromPhoto,
      listCandidates,
      listCandidatePhotos,
      getCandidate,
      updateCandidateDetails,
      setCandidateStatus,
      deleteCandidate,
      convertCandidate,
      getCandidateSuitability,
      recalculateCandidateSuitability,
      getTaxonProfile,
    },
  };
}
