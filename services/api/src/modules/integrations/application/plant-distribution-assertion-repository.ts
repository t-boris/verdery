import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantDistributionAssertion } from '../domain/plant-distribution-assertion.js';

export interface PlantDistributionAssertionRepository {
  insert(assertion: PlantDistributionAssertion): Promise<void>;
  /** Every distribution assertion recorded for one provider's own taxon identity, across every region on record — the caller narrows to the region(s) it cares about. */
  findAllForProviderTaxon(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantDistributionAssertion[]>;

  /** P11-PROV-01 — the `PlantFactAssertionRepository.findAllAwaitingReview` precedent, applied to this sibling table. */
  findAllAwaitingReview(limit: number): Promise<readonly PlantDistributionAssertion[]>;

  /** P11-PROV-01 — the `PlantFactAssertionRepository.approveReview` precedent, applied to this sibling table. */
  approveReview(assertionId: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean>;
}
