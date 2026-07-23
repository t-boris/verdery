/**
 * Read-only, authorized lookup for a single observation, enriched with its
 * photos and corrected-status the same way `listForGarden`/`listForPlant`
 * already are.
 *
 * Added for the synchronization module's `GET /v1/sync/changes` (P5-BE-02):
 * a `record: 'observation'`, `operation: 'upsert'` change needs the current
 * authorized server representation, per architecture/offline-synchronization.md's
 * own requirement that a change "contains enough information to upsert... a
 * local read-model record". `GetObservation` (this module's existing query)
 * is not reused for this: it deliberately returns the raw domain
 * `Observation`, with no authorization check and no photo/correction
 * enrichment — the right shape for a sibling module's own existence-check
 * validation (`tasks-recommendations` against `origin_observation_id`), not
 * for a pull response, which needs the same `ObservationResource` shape
 * `RecordObservation`/`CorrectObservation`/`ListObservationsForGarden` all
 * return. Named distinctly (not overloading `GetObservation`) rather than
 * changing that class's existing, narrower contract for its own established
 * caller.
 *
 * Mirrors `GetGarden`'s/`GetPlant`'s/`GetTask`'s own shape: authorize against
 * the caller-supplied `gardenId` before any repository read, then conceal
 * both "no such observation" and "this observation belongs to a different
 * garden" as the identical `observationNotFoundError`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { observationNotFoundError } from './observation-errors.js';
import type { ObservationRepository } from './observation-repository.js';
import { toObservationResource, type ObservationResource } from './observation-view.js';

export class GetObservationForSync {
  constructor(
    private readonly observations: ObservationRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    observationId: Uuid,
    profileId: Uuid,
  ): Promise<ObservationResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const entry = await this.observations.getWithHistory(observationId);
    if (entry === null || entry.observation.gardenId !== gardenId) {
      throw observationNotFoundError();
    }

    return toObservationResource(entry);
  }
}
