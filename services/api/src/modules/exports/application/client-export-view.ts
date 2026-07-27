/**
 * Resource shapes for `GetClientExportManifest` (P9C-EXPORT-01), hand-written
 * against `packages/api-contracts/openapi.yaml`'s `ClientExportManifest`
 * family — the same "application code returns the exact wire shape, never a
 * second mapping step" convention `gardens-mapping/application/
 * map-object-view.ts` documents for `GardenObjectResource`.
 *
 * `mapObjects`/`plants` reuse `GardenObjectResource`/`PlantResource` from
 * their OWNING modules unchanged (see `get-client-export-manifest.ts`'s own
 * header for why); this file only shapes the fields genuinely new here:
 * the garden identity, the media-entitlement entry, and the outer envelope.
 */

import type { GardenObjectResource, GeoreferenceResource } from '../../gardens-mapping/public.js';
import type { PlantResource } from '../../plants-inventory/public.js';
import type { ClientPublicationSummary } from '@verdery/api-contracts';

/** The accepted garden model (section 18): current identity, map, and plants — never operational history. */
export interface ClientExportGardenModelResource {
  readonly id: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly coordinateSpaceId: string;
  readonly georeference?: GeoreferenceResource;
  readonly mapObjects: readonly GardenObjectResource[];
  readonly plants: readonly PlantResource[];
}

/** One media item this client is genuinely entitled to — see `get-client-export-manifest.ts` for how entitlement is decided. */
export interface ClientExportMediaEntryResource {
  readonly mediaId: string;
  readonly access: {
    readonly url: string;
    readonly expiresAt: string;
  };
}

export interface ClientExportManifestResource {
  readonly clientGardenId: string;
  readonly generatedAt: string;
  readonly gardenModel: ClientExportGardenModelResource;
  readonly publications: readonly ClientPublicationSummary[];
  readonly media: readonly ClientExportMediaEntryResource[];
}
