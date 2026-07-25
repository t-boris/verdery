/**
 * Narrow read port into the application's stable taxonomy catalog
 * (`plants_inventory.taxonomy_reference`) — exactly the one lookup this
 * module's mapping use case needs: the identity facts (`scientificName`,
 * `commonName`) a provider-taxonomy search is phrased with.
 *
 * A port of this module rather than a growth on plants-inventory's own
 * `TaxonomyReferenceRepository`, per the established narrow-read-port
 * precedent (`MediaReferenceFinder`, `KyselyEvaluationGardenSource`): the
 * consuming module owns the read shape it needs, plants-inventory's public
 * surface stays whatever ITS callers need, and the Kysely adapter
 * (`persistence/kysely-taxonomy-identity-source.ts`) reads the other
 * schema's table directly — SELECT only, never a write, which is half of
 * the user-fact separation this work package names (the other half:
 * nothing here references a plant or garden at all; the catalog is shared
 * identity, not user garden facts).
 *
 * The row type is plants-inventory's own exported `TaxonomyReference` —
 * a public-interface type import, the `GeoreferenceRepository` precedent.
 *
 * Source: architecture/external-integrations.md, section "8. Plant Content"
 * ("Stable application taxonomy identifiers");
 * architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

import type { TaxonomyReference } from '../../plants-inventory/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface TaxonomyIdentitySource {
  /** The catalog row for `taxonomyReferenceId`, or `null` when no such reference exists. */
  findById(taxonomyReferenceId: Uuid): Promise<TaxonomyReference | null>;
}
