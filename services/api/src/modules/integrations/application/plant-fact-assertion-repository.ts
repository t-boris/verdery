import type { PlantFactAssertion } from '../domain/plant-fact-assertion.js';

export interface PlantFactAssertionRepository {
  /** `assertion.provenance.providerKey` supplies the row's own `provider_key`. */
  insert(assertion: PlantFactAssertion): Promise<void>;
  /** Every fact assertion recorded for one provider's own taxon identity — the read `RebuildPlantProfileVersion` combines across every live `PlantTaxonomyMapping` row for an application taxon. */
  findAllForProviderTaxon(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantFactAssertion[]>;
}
