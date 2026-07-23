import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Observation } from '../domain/observation.js';
import type { ObservationRepository } from './observation-repository.js';

/**
 * Existence-check query for sibling Phase 4 modules — `tasks-recommendations`
 * validates `task.origin_observation_id` against this.
 *
 * Returns the raw domain `Observation`, not a view, deliberately breaking
 * this module's own "every command returns a view" convention: unlike every
 * user-facing command here, there is no idempotency replay to keep stable
 * for this one, and a sibling module's own validation logic needs domain
 * fields (`gardenId`, in particular), not a client-facing JSON shape it has
 * no other use for.
 */
export class GetObservation {
  constructor(private readonly observations: ObservationRepository) {}

  async execute(id: Uuid): Promise<Observation | null> {
    return this.observations.get(id);
  }
}
