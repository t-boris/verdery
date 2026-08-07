/**
 * Maps the domain `PlantCandidate` to the shape a command handler
 * returns — mirrors `plant-view.ts`'s `toPlantResource` exactly: every
 * command that mutates a candidate returns this fixed view, not the domain
 * entity, since the idempotency store caches the literal response a
 * retried request must replay.
 */

import type { PlantCandidate } from '../domain/plant-candidate.js';
import type { CandidatePhotoAnalysis } from '../domain/plant-candidate.js';

export interface CandidateResource {
  readonly id: string;
  readonly gardenId: string;
  readonly proposedGardenAreaMapObjectId: string | null;
  readonly proposedPlacementMapObjectId: string | null;
  readonly displayName: string;
  readonly taxonomyReferenceId: string | null;
  readonly varietyLabel: string | null;
  readonly groupingKind: string;
  readonly quantity: number | null;
  readonly status: string;
  readonly rationaleNote: string | null;
  readonly priority: string | null;
  readonly priceAmount: number | null;
  readonly priceCurrency: string | null;
  readonly purchaseSource: string | null;
  readonly alternativeToCandidateId: string | null;
  readonly photoAnalysis: CandidatePhotoAnalysis | null;
  readonly revision: number;
  readonly createdByProfileId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toCandidateResource(candidate: PlantCandidate): CandidateResource {
  return {
    id: candidate.id,
    gardenId: candidate.gardenId,
    proposedGardenAreaMapObjectId: candidate.proposedGardenAreaMapObjectId,
    proposedPlacementMapObjectId: candidate.proposedPlacementMapObjectId,
    displayName: candidate.displayName,
    taxonomyReferenceId: candidate.taxonomyReferenceId,
    varietyLabel: candidate.varietyLabel,
    groupingKind: candidate.groupingKind,
    quantity: candidate.quantity,
    status: candidate.status,
    rationaleNote: candidate.rationaleNote,
    priority: candidate.priority,
    priceAmount: candidate.priceAmount,
    priceCurrency: candidate.priceCurrency,
    purchaseSource: candidate.purchaseSource,
    alternativeToCandidateId: candidate.alternativeToCandidateId,
    photoAnalysis: candidate.photoAnalysis,
    revision: candidate.revision,
    createdByProfileId: candidate.createdByProfileId,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}
