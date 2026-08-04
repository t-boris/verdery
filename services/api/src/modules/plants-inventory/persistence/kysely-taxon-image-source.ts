/**
 * `TaxonImageSource` over `integrations.plant_media_asset`.
 *
 * A narrow read across a module boundary, the pattern
 * `client-media-entitlement-source.ts` established: this selects the columns
 * a profile page needs and nothing else, and never writes.
 *
 * THE FILTER IS THE POINT. `ingestion_state = 'discovered'` is the state
 * enrichment assigns to an image the licence rule permitted; a refused one
 * sits at `'rejected'` and is deliberately stored, so this query must
 * exclude it explicitly rather than selecting everything and trusting the
 * caller. `license` is filtered again against the allowlist rather than
 * relying on the state alone — the two are written together today, and a
 * read that shows an image must not depend on that staying true.
 *
 * The credit line is assembled here from what the source supplied, because
 * `cc_by` may not be shown without one — see `presentationIneligibility`.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonImage, TaxonImageSource } from '../application/taxon-image-source.js';

/** Mirrors the domain allowlist; see integrations/domain/plant-media-asset.ts. */
const PRESENTABLE_LICENSES = ['public_domain', 'cc0', 'cc_by'];

export class KyselyTaxonImageSource implements TaxonImageSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listPresentable(taxonomyReferenceId: Uuid, limit: number): Promise<readonly TaxonImage[]> {
    const rows = await this.db
      .selectFrom('integrations.plant_media_asset')
      .innerJoin(
        'integrations.plant_taxonomy_mapping',
        'integrations.plant_taxonomy_mapping.provider_taxon_id',
        'integrations.plant_media_asset.provider_taxon_id',
      )
      .select([
        'integrations.plant_media_asset.id as id',
        'integrations.plant_media_asset.source_url as source_url',
        'integrations.plant_media_asset.license as license',
        'integrations.plant_media_asset.rights_holder as rights_holder',
        'integrations.plant_media_asset.attribution_text as attribution_text',
        'integrations.plant_media_asset.organ as organ',
      ])
      .where('integrations.plant_taxonomy_mapping.taxonomy_reference_id', '=', taxonomyReferenceId)
      .where('integrations.plant_media_asset.ingestion_state', '=', 'discovered')
      .where('integrations.plant_media_asset.license', 'in', PRESENTABLE_LICENSES)
      .where('integrations.plant_media_asset.source_url', 'is not', null)
      .orderBy('integrations.plant_media_asset.created_at', 'desc')
      .limit(limit)
      .execute();

    return rows
      .map((row) => ({
        id: row.id,
        // Non-null by the `is not null` predicate above.
        sourceUrl: row.source_url as string,
        license: row.license,
        attribution: row.attribution_text ?? row.rights_holder,
        organ: row.organ,
      }))
      .filter(
        // Last line: `cc_by` grants use on condition of credit, so an image
        // with nothing to display as a credit is not sent at all. Enrichment
        // already refuses these, and this refuses them again — a licence
        // breach must not be one forgotten write path away.
        (image) => image.license !== 'cc_by' || image.attribution !== null,
      );
  }
}
