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
  AddPlant,
  AddPlantFromPhoto,
  AttachPlantPhoto,
  ConfirmPlantIdentification,
  GetPlant,
  KyselyPlantRepository,
  KyselyPlantsInventoryUnitOfWork,
  KyselyTaxonomyReferenceRepository,
  MovePlant,
  SearchPlants,
  SearchTaxonomyReferences,
  SetPlantStatus,
  SetPrimaryPlantPhoto,
  TransitionPlantLifecycleStage,
  UpdatePlantDetails,
} from './modules/plants-inventory/public.js';
import type { PlantRoutesDependencies } from './modules/plants-inventory/public.js';
import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import type { IdentifyPlantSpecies } from './modules/integrations/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from './shared/time/clock.js';

export function composePlantsInventory(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  identifyPlantSpecies: IdentifyPlantSpecies,
): PlantRoutesDependencies {
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
  );
  const getPlant = new GetPlant(plantRepository, gardenAuthorization);
  const searchPlants = new SearchPlants(plantRepository, gardenAuthorization);
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

  return {
    addPlant,
    addPlantFromPhoto,
    getPlant,
    searchPlants,
    updatePlantDetails,
    attachPlantPhoto,
    setPrimaryPlantPhoto,
    confirmPlantIdentification,
    transitionPlantLifecycleStage,
    setPlantStatus,
    movePlant,
    searchTaxonomyReferences,
  };
}
