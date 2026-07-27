/**
 * Bed-occupancy history (P9D-SEASON-DATA-01): reconstructs "which taxon
 * occupied bed X during interval [t1, t2]" from `plants_inventory
 * .plant_revision`'s own placement/taxonomy snapshot columns — see
 * `migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql`'s
 * own header for why this is a derived read over the existing journal
 * rather than a second, separately-maintained interval table.
 *
 * RECONSTRUCTION LOGIC, stated precisely (the implementation,
 * `persistence/kysely-bed-occupancy-history-reader.ts`, is exactly this in
 * SQL):
 *
 * 1. A plant's "placement events" are every `plant_revision` row that
 *    carries a non-null `gardenAreaMapObjectId`/`placementMapObjectId`
 *    snapshot (only `addPlant`/`addPlantFromPhoto`/`movePlant` write one —
 *    see `PlantRevisionJournalEntry`'s own doc comment). Ordered by
 *    revision, each event's `gardenAreaMapObjectId` is where the plant
 *    stood from that event's `recordedAt` until the NEXT placement event
 *    for the SAME plant (or indefinitely, if there is no next one).
 * 2. Filtering those events to `gardenAreaMapObjectId = bedMapObjectId`
 *    yields every "occupied THIS bed" segment: `occupiedFrom` is the
 *    event's own `recordedAt`; `occupiedUntil` is the NEXT placement
 *    event's `recordedAt` for that plant (regardless of which bed it
 *    targets — leaving is leaving), or `null` if the plant has not moved
 *    since.
 * 3. The taxon attributed to a segment is the LATEST non-null
 *    `taxonomyReferenceId` snapshot for that plant at a revision BEFORE the
 *    segment's own closing placement event (or, for an open segment, the
 *    latest snapshot at any revision — equivalently, the plant's current
 *    taxonomy). This is deliberately "best known identification as of when
 *    the plant left the bed (or now, if it has not left)", not "as of when
 *    it arrived" — a plant identified only after being planted still
 *    correctly attributes its family to the bed it has been growing in the
 *    whole time it was unidentified, while an identification made only
 *    AFTER the plant later moved to a different bed does not retroactively
 *    rewrite the earlier segment's taxon (that identification's own
 *    revision falls after the segment's closing event).
 *
 * Only segments overlapping `[intervalStart, intervalEnd]` are returned —
 * `occupiedFrom <= intervalEnd AND (occupiedUntil IS NULL OR occupiedUntil
 * >= intervalStart)`, the ordinary half-open interval overlap test.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface BedOccupancyPeriod {
  readonly plantId: Uuid;
  /** `null` when the plant had no taxonomy snapshot at or before this segment closed — an unidentified plant is a legitimate occupant. */
  readonly taxonomyReferenceId: Uuid | null;
  readonly occupiedFrom: Date;
  /** `null` means the plant has not since had another placement event — it may still occupy this bed as of "now". */
  readonly occupiedUntil: Date | null;
}

export interface BedOccupancyHistoryReader {
  /** Every occupancy segment for `bedMapObjectId` overlapping `[intervalStart, intervalEnd]`, ordered by `occupiedFrom` ascending. */
  findForBed(
    bedMapObjectId: Uuid,
    intervalStart: Date,
    intervalEnd: Date,
  ): Promise<readonly BedOccupancyPeriod[]>;
}
