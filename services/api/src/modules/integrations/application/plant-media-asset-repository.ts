/**
 * Storage port for licensed taxon imagery.
 *
 * `upsert`, not `insert`: enrichment runs repeatedly over the same taxon, and
 * a source's claim about one image can CHANGE — a licence is re-stated, an
 * image is withdrawn. Re-running must refresh the row rather than add a
 * second copy of the same photograph, which is what
 * `plant_media_asset_provider_source_unique` makes possible.
 *
 * A refused asset is stored too, at `ingestion_state = 'rejected'`; see
 * `domain/plant-media-asset.ts` on why a refusal is a fact worth keeping.
 */

import type { PlantMediaAsset } from '../domain/plant-media-asset.js';

export interface PlantMediaAssetRepository {
  /**
   * `providerKey` is separate because `PlantMediaAsset` carries no
   * provenance of its own — the same split `PlantFactAssertion` uses, where
   * the provider is the caller's context rather than a property of the
   * claim.
   */
  upsert(providerKey: string, asset: PlantMediaAsset): Promise<void>;
}
