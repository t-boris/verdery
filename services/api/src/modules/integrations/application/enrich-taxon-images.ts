import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonImageEnricher } from '../../plants-inventory/public.js';
import type { RefreshTaxonAssertions } from './refresh-taxon-assertions.js';

/** Runs configured provider enrichment on demand so licensed taxon imagery is warm before a catalog read returns. */
export class EnrichTaxonImages implements TaxonImageEnricher {
  constructor(
    private readonly refreshTaxonAssertions: RefreshTaxonAssertions,
    private readonly providerKeys: readonly string[],
  ) {}

  async enrich(taxonomyReferenceId: Uuid): Promise<void> {
    for (const providerKey of this.providerKeys) {
      const result = await this.refreshTaxonAssertions.execute({
        taxonomyReferenceId,
        providerKey,
      });
      if (result.outcome === 'unavailable' && result.reason === 'quotaExhausted') return;
    }
  }
}
