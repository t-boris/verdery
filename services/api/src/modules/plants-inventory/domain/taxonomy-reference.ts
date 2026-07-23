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
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `plants_inventory.taxonomy_reference`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type TaxonomySource = 'system_catalog' | 'user_defined';

export interface TaxonomyReference {
  readonly id: Uuid;
  readonly scientificName: string;
  readonly commonName: string | null;
  readonly varietyName: string | null;
  readonly source: TaxonomySource;
  /** `null` for system-catalog rows, seeded independently of any profile; set for user-defined rows. */
  readonly createdByProfileId: Uuid | null;
  readonly createdAt: Date;
}
