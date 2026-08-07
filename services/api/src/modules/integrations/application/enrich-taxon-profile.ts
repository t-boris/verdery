import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonProfileEnricher } from '../../plants-inventory/public.js';
import type { PlantProfileVersionRebuilder } from './run-taxon-enrichment-sweep.js';
import type { RefreshTaxonAssertions } from './refresh-taxon-assertions.js';

/** Warms cited facts and licensed imagery, then materializes the profile before the catalog read returns. */
export class EnrichTaxonProfile implements TaxonProfileEnricher {
  constructor(
    private readonly refreshTaxonAssertions: RefreshTaxonAssertions,
    private readonly rebuildPlantProfileVersion: PlantProfileVersionRebuilder,
    private readonly providerKeys: readonly string[],
  ) {}

  async enrich(taxonomyReferenceId: Uuid): Promise<void> {
    for (const providerKey of this.providerKeys) {
      const result = await this.refreshTaxonAssertions.execute({
        taxonomyReferenceId,
        providerKey,
      });
      if (result.outcome === 'unavailable' && result.reason === 'quotaExhausted') break;
    }

    await this.rebuildPlantProfileVersion.execute(taxonomyReferenceId, this.providerKeys);
  }
}
