/**
 * The images this module may show beside a taxon profile.
 *
 * A narrow cross-module read port, the established pattern
 * (`client-media-entitlement-source.ts` is the precedent): `integrations`
 * owns `plant_media_asset` and every licence question about it, and
 * `plants-inventory` reads the answer rather than the table.
 *
 * The port promises PRESENTABLE images only. An implementation that returned
 * a refused one would push a licence decision out to the client, where it
 * would be made by whoever renders an `<img>` — which is how a
 * non-commercial photograph ends up on a commercial page.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface TaxonImage {
  readonly id: Uuid;
  readonly sourceUrl: string;
  /** Always an allowlisted licence — `public_domain`, `cc0`, or `cc_by`. */
  readonly license: string;
  /** The credit line to display, or null when the licence imposes no attribution condition. */
  readonly attribution: string | null;
  readonly organ: string | null;
}

export interface TaxonImageSource {
  listPresentable(taxonomyReferenceId: Uuid, limit: number): Promise<readonly TaxonImage[]>;
}
