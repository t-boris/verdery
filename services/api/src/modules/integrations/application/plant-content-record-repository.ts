/**
 * Port to this module's own `integrations.plant_content_record` storage —
 * the established port-plus-adapter-plus-fake convention; the real adapter
 * is `persistence/kysely-plant-content-record-repository.ts`, unit tests use
 * `integrations-test-doubles.ts`'s in-memory fake.
 *
 * Deliberately minimal: exactly the two operations this stage's use cases
 * perform. Rows are append-only (a fetch result is a historical fact, and
 * "User edits do not overwrite provider source records" — every version
 * stays), so no update or delete exists.
 *
 * Source: migrations/1785900000000_integrations-plant-content-baseline.sql.
 */

import type { PlantContentRecord } from '../domain/plant-content-record.js';

export interface PlantContentRecordRepository {
  /** Appends one fetch's record. */
  insert(record: PlantContentRecord): Promise<void>;

  /**
   * The most recently FETCHED record for one provider taxon, or `null` when
   * none exists. Keyed by the PROVIDER's identity, not an application one —
   * application-taxonomy resolution goes through the live mapping, so a
   * rejected mapping stops resolving content without touching these rows.
   */
  findLatest(providerKey: string, providerTaxonId: string): Promise<PlantContentRecord | null>;
}
