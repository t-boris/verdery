/**
 * A row in the plant-identification catalog: either a system-seeded
 * reference (`source: 'system_catalog'`) or one a profile defined themselves
 * (`source: 'user_defined'`). Read-only in this pass — no
 * `CreateTaxonomyReference` command exists yet; see this module's `public.ts`
 * doc comment for why that was deliberately scoped out.
 *
 * No update function: the migration's own doc comment on
 * `plants_inventory.taxonomy_reference` says "No UPDATE path: a wrong entry
 * is superseded by a new row, not edited in place, since other plants may
 * already reference it by id" — the same immutability rule
 * `media.media_record` follows.
 *
 * `family`/`genus` (P9D-SEASON-DATA-01): additive nullable columns, the same
 * "unknown stays unknown" latitude `commonName`/`varietyName` already take.
 * Purely additive because this table has no application-layer write path at
 * all — see this class's own header above and
 * `migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql`'s
 * header for the research that confirmed it (every row is seeded or
 * inserted directly by a test fixture, never created through a command).
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `plants_inventory.taxonomy_reference`;
 * migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type TaxonomySource = 'system_catalog' | 'user_defined';

export interface TaxonomyReference {
  readonly id: Uuid;
  readonly scientificName: string;
  readonly commonName: string | null;
  readonly varietyName: string | null;
  /** Botanical family (e.g. `'Solanaceae'`) — `null` when not yet catalogued. Consumed by Stage 2's `crop-rotation-caution` rule (P9D-SEASON-RULES-01), not built in this pass. */
  readonly family: string | null;
  /** Botanical genus (e.g. `'Solanum'`) — `null` when not yet catalogued. */
  readonly genus: string | null;
  readonly source: TaxonomySource;
  /** `null` for system-catalog rows, seeded independently of any profile; set for user-defined rows. */
  readonly createdByProfileId: Uuid | null;
  readonly createdAt: Date;
}
