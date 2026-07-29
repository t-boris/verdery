/**
 * Maps the domain `Plant` to the shape a command handler returns.
 *
 * Application code returns this view, not the domain entity, from every
 * command that mutates `plant` — matching gardens-mapping's own
 * `toGardenResource` convention: the idempotency store caches the literal
 * response a retried request must replay, so what a use case returns must be
 * one fixed shape.
 *
 * This module has no HTTP route this pass (see `public.ts` — deliberately
 * absent, the same reason `media`'s own `MediaRecordResource` gives), so
 * there is no `@verdery/api-contracts` `Plant` schema to conform to yet.
 * This resource shape is this module's own for now, ready for that contract
 * to adopt once a route exists — unlike `GardenObjectResource`, which omits
 * null-valued optional fields to match a real OpenAPI schema exactly, this
 * one carries every field directly (including nulls), the same simplicity
 * `MediaRecordResource` uses for the identical reason.
 */

import type { Plant } from '../domain/plant.js';

export interface PlantResource {
  readonly id: string;
  readonly gardenId: string;
  readonly gardenAreaMapObjectId: string | null;
  readonly placementMapObjectId: string | null;
  readonly displayName: string;
  readonly taxonomyReferenceId: string | null;
  readonly varietyLabel: string | null;
  readonly acceptedIdentificationId: string | null;
  readonly acquisitionDate: string | null;
  readonly acquisitionDateType: string | null;
  readonly groupingKind: string;
  readonly quantity: number | null;
  readonly lifecycleStage: string;
  readonly status: string;
  readonly conditionNote: string | null;
  readonly careGuidanceNote: string | null;
  readonly revision: number;
  readonly createdByProfileId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * The plant's cover photo, as a `mediaId` a client resolves to a signed
   * URL via `GetMediaAccess` — `null` when the plant has no photo, or when
   * this resource was not built from a context that looked one up (photos
   * are a separate aggregate, `plant_photo`, not part of the domain `Plant`
   * itself; only `SearchPlants` currently populates this, via
   * `PlantPhotoRepository.findCoverMediaIdsForPlants`'s own bulk lookup, so
   * a garden's whole plant list needs one query rather than one per row).
   */
  readonly coverMediaId: string | null;
}

export function toPlantResource(plant: Plant, coverMediaId: string | null = null): PlantResource {
  return {
    id: plant.id,
    gardenId: plant.gardenId,
    gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
    placementMapObjectId: plant.placementMapObjectId,
    displayName: plant.displayName,
    taxonomyReferenceId: plant.taxonomyReferenceId,
    varietyLabel: plant.varietyLabel,
    acceptedIdentificationId: plant.acceptedIdentificationId,
    acquisitionDate: plant.acquisitionDate,
    acquisitionDateType: plant.acquisitionDateType,
    groupingKind: plant.groupingKind,
    quantity: plant.quantity,
    lifecycleStage: plant.lifecycleStage,
    status: plant.status,
    conditionNote: plant.conditionNote,
    careGuidanceNote: plant.careGuidanceNote,
    revision: plant.revision,
    createdByProfileId: plant.createdByProfileId,
    createdAt: plant.createdAt.toISOString(),
    updatedAt: plant.updatedAt.toISOString(),
    coverMediaId,
  };
}
