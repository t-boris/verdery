/**
 * Converts a candidate into a real, actual plant: an explicit, idempotent,
 * revision-aware command, not a status flag flip. See the migration's own
 * header (`1787600000000_plant-candidates-and-conversion.sql`) for why
 * `candidate_conversion`'s `UNIQUE (candidate_id)` is the authoritative
 * at-most-once guard, with this command's own revision check as the first,
 * ordinary-case line of defense.
 *
 * Builds the new plant from the candidate's ORIGINAL (pre-conversion)
 * fields — `convertCandidateToPlant` itself calls `requireConvertibleCandidate`,
 * which would reject an already-converted candidate; calling it before this
 * command's own `markCandidateConverted` write keeps that check meaningful.
 */

import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { AcquisitionDateType, PlantPlacement } from '../domain/plant.js';
import { convertCandidateToPlant, markCandidateConverted } from '../domain/candidate-conversion.js';
import type { CandidateConversion } from '../domain/candidate-conversion.js';
import type { PlantCandidate } from '../domain/plant-candidate.js';
import { createPlantPhoto } from '../domain/plant-photo.js';
import { candidateAlreadyConvertedError, candidateStaleRevisionError } from './candidate-errors.js';
import { toCandidateResource, type CandidateResource } from './candidate-view.js';
import type { PlantCandidateRepository } from './plant-candidate-repository.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { toPlantResource, type PlantResource } from './plant-view.js';
import { requireCandidateAndAuthorize } from './require-candidate-and-authorize.js';
import { requirePlacementReferencesGardenObjects } from './require-plant-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.convertCandidate';
const CONVERSION_UNIQUE_CONSTRAINT = 'candidate_conversion_candidate_id_key';

export interface ConvertCandidateInput {
  /** Client-generated id for the new plant, optional — same reason `AddPlantInput.plantId?` is. */
  readonly plantId?: Uuid;
  /** Defaults to the candidate's own proposed placement when omitted — see `convertCandidateToPlant`'s own doc comment. */
  readonly gardenAreaMapObjectId?: Uuid | null;
  readonly placementMapObjectId?: Uuid | null;
  readonly acquisitionDate?: string | null;
  readonly acquisitionDateType?: AcquisitionDateType | null;
}

/** `convertedAt` as an ISO string — mirrors every other resource view's `Date -> string` mapping. */
export interface CandidateConversionResource {
  readonly id: string;
  readonly candidateId: string;
  readonly plantId: string;
  readonly convertedByProfileId: string;
  readonly convertedAt: string;
}

export interface ConvertCandidateResult {
  readonly plant: PlantResource;
  readonly candidate: CandidateResource;
  readonly conversion: CandidateConversionResource;
}

function toConversionResource(conversion: CandidateConversion): CandidateConversionResource {
  return {
    id: conversion.id,
    candidateId: conversion.candidateId,
    plantId: conversion.plantId,
    convertedByProfileId: conversion.convertedByProfileId,
    convertedAt: conversion.convertedAt.toISOString(),
  };
}

function finalPlacement(candidate: PlantCandidate, input: ConvertCandidateInput): PlantPlacement {
  return {
    gardenAreaMapObjectId:
      input.gardenAreaMapObjectId !== undefined
        ? input.gardenAreaMapObjectId
        : candidate.proposedGardenAreaMapObjectId,
    placementMapObjectId:
      input.placementMapObjectId !== undefined
        ? input.placementMapObjectId
        : candidate.proposedPlacementMapObjectId,
  };
}

export class ConvertCandidate {
  constructor(
    private readonly candidates: PlantCandidateRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    candidateId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    input: ConvertCandidateInput,
    idempotencyKey: string,
  ): Promise<ConvertCandidateResult> {
    await requireCandidateAndAuthorize(this.candidates, this.authorization, candidateId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ candidateId, expectedRevision, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        const now = this.clock.now();
        const candidate = await context.candidates.findById(candidateId);
        if (candidate === null) {
          throw candidateStaleRevisionError(expectedRevision);
        }
        if (candidate.revision !== expectedRevision) {
          throw candidateStaleRevisionError(candidate.revision);
        }

        const placement = finalPlacement(candidate, input);
        await requirePlacementReferencesGardenObjects(
          context.mapObjects,
          candidate.gardenId,
          placement,
        );

        const plant = convertCandidateToPlant(
          input.plantId ?? generateUuidV7(),
          candidate,
          placement,
          input.acquisitionDate ?? null,
          input.acquisitionDateType ?? null,
          profileId,
          now,
        );
        await context.plants.insert(plant);

        // Candidate photographs are observations of this exact specimen, not
        // disposable input to identification. Conversion creates new plant-
        // photo links to the same immutable media records, preserving order
        // and the primary choice while retaining the candidate's audit trail.
        const candidatePhotos = await context.candidatePhotos.findAllForCandidate(candidateId);
        for (const candidatePhoto of candidatePhotos) {
          await context.plantPhotos.insert(
            createPlantPhoto(
              generateUuidV7(),
              plant.id,
              candidatePhoto.mediaId,
              candidatePhoto.isPrimary,
              candidatePhoto.createdAt,
            ),
          );
        }
        await context.revisionJournal.record({
          plantId: plant.id,
          revision: plant.revision,
          commandType: 'convertCandidate',
          lifecycleStage: plant.lifecycleStage,
          status: plant.status,
          gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
          placementMapObjectId: plant.placementMapObjectId,
          taxonomyReferenceId: plant.taxonomyReferenceId,
          actorProfileId: profileId,
        });

        const convertedCandidate = markCandidateConverted(candidate, now);
        const applied = await context.candidates.update(convertedCandidate, candidate.revision);
        if (!applied) {
          throw candidateStaleRevisionError(candidate.revision);
        }

        const conversion: CandidateConversion = {
          id: generateUuidV7(),
          candidateId,
          plantId: plant.id,
          convertedByProfileId: profileId,
          convertedAt: now,
        };
        try {
          await context.candidateConversions.insert(conversion);
        } catch (error) {
          if (
            isUniqueViolation(error) &&
            postgresConstraintName(error) === CONVERSION_UNIQUE_CONSTRAINT
          ) {
            throw candidateAlreadyConvertedError();
          }
          throw error;
        }

        // The new PLANT already uses the existing 'plant' SyncRecordType, so
        // its own push/pull sync works today. The CANDIDATE side of this
        // command does not sync yet — see `add-candidate.ts`'s note; a
        // client cannot observe another client's conversion of a shared
        // candidate until candidate sync is built.
        await context.syncChanges.record({
          gardenId: plant.gardenId,
          recordId: plant.id,
          recordType: 'plant',
          operation: 'upsert',
          recordRevision: plant.revision,
        });

        return {
          plant: toPlantResource(plant),
          candidate: toCandidateResource(convertedCandidate),
          conversion: toConversionResource(conversion),
        };
      },
    );
  }
}
