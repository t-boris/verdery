import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** Cache-aside boundary for obtaining licensed reference imagery from configured worldwide providers. */
export interface TaxonImageEnricher {
  enrich(taxonomyReferenceId: Uuid): Promise<void>;
}
