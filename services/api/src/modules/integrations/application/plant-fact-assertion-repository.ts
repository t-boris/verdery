import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantFactAssertion } from '../domain/plant-fact-assertion.js';

export interface PlantFactAssertionRepository {
  /** `assertion.provenance.providerKey` supplies the row's own `provider_key`. */
  insert(assertion: PlantFactAssertion): Promise<void>;
  /** Every fact assertion recorded for one provider's own taxon identity — the read `RebuildPlantProfileVersion` combines across every live `PlantTaxonomyMapping` row for an application taxon. */
  findAllForProviderTaxon(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantFactAssertion[]>;

  /**
   * P11-PROV-01: every fact assertion still `awaiting_horticultural_review`,
   * oldest-fetched first, capped at `limit` — the reviewer queue's own read.
   * Cited facts may be visible in a materialized catalog profile as
   * source-backed, but never in a suitability finding until a human promotes
   * them out of this list (`run-taxon-enrichment-sweep.ts`'s own header).
   */
  findAllAwaitingReview(limit: number): Promise<readonly PlantFactAssertion[]>;

  /**
   * Approves one assertion's review, guarded by the expected current status
   * (the caller validates the candidate through `validatePlantAssertionReview`
   * first — the repository stores, the domain decides, the
   * `PlantTaxonomyMappingRepository.updateVerificationState` precedent).
   * Returns `false` when the row is not `awaiting_horticultural_review`
   * anymore (a lost race — the caller re-reads), `true` when applied. There
   * is no reject path: no `rejected` review state exists in the migration's
   * own CHECK constraint, so this is the only mutation this port offers
   * beyond `insert`.
   */
  approveReview(assertionId: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean>;
}
