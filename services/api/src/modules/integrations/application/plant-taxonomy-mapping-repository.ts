/**
 * Port to this module's own `integrations.plant_taxonomy_mapping` storage —
 * the established port-plus-adapter-plus-fake convention; the real adapter
 * is `persistence/kysely-plant-taxonomy-mapping-repository.ts`, unit tests
 * use `integrations-test-doubles.ts`'s in-memory fake.
 *
 * Identity rows are immutable: `insert` is the only way a mapping comes to
 * exist, and the single mutation is the guarded verification-state
 * transition (`updateVerificationState`) — the identity triple can never be
 * re-pointed, which is what makes re-identification an explicit pair of
 * durable rows instead of a silent edit.
 *
 * No application use case drives `updateVerificationState` yet, deliberately:
 * verifying or rejecting an identity claim is a human judgment and no
 * reviewer-facing surface exists this phase (the read-only
 * `taxonomy_reference` posture — the stage that builds the surface wires the
 * command it needs). The port carries the operation so the machinery is
 * proven, and the domain transition rules gate it either way.
 *
 * Source: migrations/1785900000000_integrations-plant-content-baseline.sql.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PlantTaxonomyMapping,
  TaxonomyMappingVerificationState,
} from '../domain/plant-taxonomy-mapping.js';

export interface PlantTaxonomyMappingRepository {
  /**
   * Persists a new mapping. Returns `false` — inserting nothing — when a
   * live (non-rejected) mapping for the same (providerKey,
   * taxonomyReferenceId) already exists, so concurrent mapping attempts
   * cannot create duplicates and the caller re-reads the winner instead of
   * failing. Backed by the partial unique index
   * `plant_taxonomy_mapping_live_identity_idx`.
   */
  insert(mapping: PlantTaxonomyMapping): Promise<boolean>;

  /**
   * The live (non-rejected) mapping for one provider and one application
   * taxonomy identity, or `null`. At most one exists, by the same partial
   * unique index.
   */
  findLive(providerKey: string, taxonomyReferenceId: Uuid): Promise<PlantTaxonomyMapping | null>;

  /**
   * Moves one mapping's verification state, guarded by the expected current
   * state (callers validate the move through
   * `validateMappingStateTransition` first — the repository stores, the
   * domain decides). Returns `false` when the row is not in
   * `expectedCurrentState` anymore (a lost race — the caller re-reads),
   * `true` when the transition was applied with `stateNote`/`stateChangedAt`
   * recorded.
   */
  updateVerificationState(
    mappingId: Uuid,
    expectedCurrentState: TaxonomyMappingVerificationState,
    nextState: TaxonomyMappingVerificationState,
    stateNote: string | null,
    stateChangedAt: Date,
  ): Promise<boolean>;
}
