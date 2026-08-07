/**
 * Persistence port for `plants_inventory.taxonomy_seasonal_fact`
 * (P9D-SEASON-DATA-01).
 *
 * Read-only in this pass — no write command exists (see
 * `domain/taxonomy-seasonal-fact.ts`'s own header for why: rows are
 * seed/fixture content, immutable after insert, the same posture
 * `taxonomy_reference` itself already takes).
 *
 * `findReviewedForTaxonomyAndHemisphere` is the narrow read port Stage 2
 * (P9D-SEASON-RULES-01, a separate later work package) will consume for its
 * `seasonal-sowing-window-check`/`crop-rotation-caution` rules — exported
 * narrowly through `public.ts`, the same "export a narrow read port, don't
 * build the consumer yet" discipline `GardenContextFactRepository`/
 * `ListGardenContextFacts` already established for P9D-CONTEXT-01's sibling
 * table.
 *
 * THE REVIEW-STATUS FILTER IS THE ENFORCEMENT POINT: this method only ever
 * returns a row whose `reviewStatus` is `'horticulturally_reviewed'` — an
 * `awaiting_horticultural_review` row for the same `(taxonomyReferenceId,
 * hemisphere)` is treated identically to no row at all. A rule-facing
 * caller therefore cannot accidentally read unreviewed content; the
 * filtering is not deferred to whatever reads this port later.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Hemisphere, TaxonomySeasonalFact } from '../domain/taxonomy-seasonal-fact.js';

export interface TaxonomySeasonalFactRepository {
  /** The `horticulturally_reviewed` seasonal fact for this taxon and hemisphere, or `null` when none exists OR the only row present is still `awaiting_horticultural_review`. */
  findReviewedForTaxonomyAndHemisphere(
    taxonomyReferenceId: Uuid,
    hemisphere: Hemisphere,
  ): Promise<TaxonomySeasonalFact | null>;

  /**
   * Rows still `awaiting_horticultural_review`, oldest first, capped — the
   * reviewer queue's own read.
   *
   * Deliberately unfiltered by taxon: a reviewer works through a backlog
   * rather than looking a specific plant up, exactly as
   * `ListPlantAssertionsAwaitingReview` already assumes for its own queue.
   */
  listAwaitingReview(limit: number): Promise<readonly TaxonomySeasonalFactReviewItem[]>;

  /**
   * Promotes one row to `horticulturally_reviewed`, stamping the reviewer
   * and the date. Returns `false` when the row is not awaiting review
   * anymore — already signed off, or no such id.
   *
   * The two are indistinguishable on purpose, the same choice
   * `ApprovePlantAssertionReview` documents: both mean "there is nothing
   * left for this caller to approve", and telling them apart would let an
   * unauthorized probe confirm an id exists.
   */
  approve(id: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean>;
}

/**
 * One queue entry: the fact plus the taxon name a reviewer needs to judge
 * it. Without the name the queue would be a list of UUIDs and month
 * numbers, which is not reviewable content.
 */
export interface TaxonomySeasonalFactReviewItem {
  readonly fact: TaxonomySeasonalFact;
  readonly scientificName: string;
  readonly commonName: string | null;
}
