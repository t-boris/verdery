/**
 * Kysely adapter for `TaxonEnrichmentCandidateSource` — see the port's own
 * header comment for the selection and ordering semantics, and for why
 * this cross-schema read lives here.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonEnrichmentCandidateSource } from '../application/taxon-enrichment-candidate-source.js';

export class KyselyTaxonEnrichmentCandidateSource implements TaxonEnrichmentCandidateSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listEnrichmentCandidates(limit: number): Promise<readonly Uuid[]> {
    const referencedTaxa = this.db
      .selectFrom('plants_inventory.plant')
      .select('taxonomy_reference_id as taxonomy_reference_id')
      .where('taxonomy_reference_id', 'is not', null)
      .union(
        this.db
          .selectFrom('plants_inventory.plant_candidate')
          .select('taxonomy_reference_id as taxonomy_reference_id')
          .where('taxonomy_reference_id', 'is not', null),
      );

    const rows = await this.db
      .selectFrom(referencedTaxa.as('referenced_taxon'))
      .leftJoin(
        // Latest MATERIALIZATION per taxon — the same read
        // `WeatherRefreshCandidateSource`'s cache decision starts from,
        // aggregated.
        (eb) =>
          eb
            .selectFrom('plants_inventory.plant_profile_version as profile_version')
            .groupBy('profile_version.taxonomy_reference_id')
            .select('profile_version.taxonomy_reference_id')
            .select((inner) => inner.fn.max('profile_version.created_at').as('latest_created_at'))
            .as('latest_profile_version'),
        (join) =>
          join.onRef(
            'latest_profile_version.taxonomy_reference_id',
            '=',
            'referenced_taxon.taxonomy_reference_id',
          ),
      )
      .select(['referenced_taxon.taxonomy_reference_id as taxonomy_reference_id'])
      .orderBy('latest_profile_version.latest_created_at', (ob) => ob.asc().nullsFirst())
      .orderBy('referenced_taxon.taxonomy_reference_id', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => row.taxonomy_reference_id).filter((id): id is Uuid => id !== null);
  }
}
