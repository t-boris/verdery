/**
 * `PlantMediaAssetRepository` over PostgreSQL.
 *
 * The conflict target is `plant_media_asset_provider_source_unique`, the
 * partial index over `(provider_key, source_url)`: re-running enrichment
 * refreshes what the source now claims — including a licence that changed,
 * which is how a withdrawn image stops being presentable — rather than
 * inserting a second copy of one photograph.
 *
 * `id` and `created_at` are deliberately NOT updated on conflict: the row
 * keeps the identity and discovery time it was first stored with, so "when
 * did this application first see this image" stays answerable.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { PlantMediaAssetRepository } from '../application/plant-media-asset-repository.js';
import type { PlantMediaAsset } from '../domain/plant-media-asset.js';

export class KyselyPlantMediaAssetRepository implements PlantMediaAssetRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async upsert(providerKey: string, asset: PlantMediaAsset): Promise<void> {
    await this.db
      .insertInto('integrations.plant_media_asset')
      .values({
        id: asset.id,
        provider_key: providerKey,
        provider_taxon_id: asset.providerTaxonId,
        media_id: asset.mediaId,
        source_url: asset.sourceUrl,
        organ: asset.organ,
        inferred_organ: asset.inferredOrgan,
        license: asset.license,
        attribution_text: asset.attributionText,
        creator: asset.creator,
        rights_holder: asset.rightsHolder,
        observed_at: asset.observedAt,
        generalized_location: asset.generalizedLocation,
        ingestion_state: asset.ingestionState,
      })
      .onConflict((conflict) =>
        conflict.columns(['provider_key', 'source_url']).doUpdateSet({
          license: asset.license,
          rights_holder: asset.rightsHolder,
          creator: asset.creator,
          attribution_text: asset.attributionText,
          observed_at: asset.observedAt,
          organ: asset.organ,
          inferred_organ: asset.inferredOrgan,
          ingestion_state: asset.ingestionState,
        }),
      )
      .execute();
  }
}
