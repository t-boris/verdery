import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** Cache-aside boundary for obtaining a taxon's cited facts and licensed reference imagery. */
export interface TaxonProfileEnricher {
  enrich(taxonomyReferenceId: Uuid): Promise<void>;
}
