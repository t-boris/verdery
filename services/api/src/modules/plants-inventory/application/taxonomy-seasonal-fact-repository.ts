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
 * ACCEPTANCE IS THE ENFORCEMENT POINT, AND IT IS PER GARDEN. A fact is
 * readable by the rules for a garden only when that garden's own owner or
 * editor accepted it (`garden_seasonal_fact_acceptance`). A fact nobody in
 * this garden has accepted is treated identically to no row at all, however
 * many other gardens accepted it. A rule-facing caller therefore cannot
 * accidentally read content this garden never agreed to, and cannot read
 * another garden's decision; the filtering is not deferred to whatever reads
 * this port later.
 *
 * WHY NOT A GLOBAL SIGN-OFF. The previous design gated on a
 * `horticulturally_reviewed` status set by a named horticulturist from an
 * allowlist. That allowlist was never wired to the deployed service, so no
 * row could ever be promoted and the three seasonal rules were permanently
 * silent. The gate is now held by the person who already has authority over
 * the garden the decision affects — see the migration's own header for why
 * that is safe here and would not have been safe as a global status.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Hemisphere, TaxonomySeasonalFact } from '../domain/taxonomy-seasonal-fact.js';

export interface TaxonomySeasonalFactRepository {
  /** The seasonal fact for this taxon and hemisphere that THIS garden has accepted, or `null` when none exists or this garden has not accepted it. */
  findAcceptedForGarden(
    gardenId: Uuid,
    taxonomyReferenceId: Uuid,
    hemisphere: Hemisphere,
  ): Promise<TaxonomySeasonalFact | null>;

  /**
   * Facts this garden could accept but has not: one per taxon the garden
   * actually grows, for the garden's own hemisphere, oldest first, capped.
   *
   * Deliberately filtered by the garden's own taxa, unlike the global queue
   * it replaces. A gardener is deciding about the plants in front of them,
   * not working a backlog of taxa they have never planted, and a list of
   * the latter would be a list nobody could meaningfully sign.
   */
  listAwaitingAcceptanceForGarden(
    gardenId: Uuid,
    hemisphere: Hemisphere,
    limit: number,
  ): Promise<readonly TaxonomySeasonalFactReviewItem[]>;

  /**
   * Records this garden's acceptance of one fact, stamping who accepted it
   * and on what date. Returns `false` when the fact does not exist or does
   * not match the garden's hemisphere.
   *
   * Idempotent: accepting twice leaves one row and still returns `true`, so
   * a retried or double-submitted accept is not an error. The unique
   * `(garden_id, taxonomy_seasonal_fact_id)` key does that work.
   */
  acceptForGarden(input: GardenSeasonalFactAcceptanceInput): Promise<boolean>;

  /**
   * Inserts a proposal for a `(taxon, hemisphere)` that has none, always
   * `awaiting_horticultural_review`. Returns `false` when a row already
   * exists for that pair — the table's own unique key — so a repeated pass
   * proposes nothing twice and never overwrites a reviewer's work.
   *
   * There is no update path and no `insertReviewed`: a proposal can only
   * ever enter the queue, and the only way out of the queue is
   * `approve`.
   */
  insertProposal(input: TaxonomySeasonalFactProposalInput): Promise<boolean>;
}

/**
 * One garden's acceptance. `acceptedByProfileId` is the authenticated
 * caller's own profile, never a caller-supplied value: a person can only
 * record THEMSELVES as having accepted something, which is what makes the
 * column an accountable claim.
 */
export interface GardenSeasonalFactAcceptanceInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly taxonomySeasonalFactId: Uuid;
  readonly acceptedByProfileId: Uuid;
  /** `YYYY-MM-DD`, from the injected clock. */
  readonly acceptedOn: string;
  /** The garden's own hemisphere, checked against the fact's so a garden cannot accept timing computed for the other half of the world. */
  readonly hemisphere: Hemisphere;
}

/**
 * A drafted proposal. `authoringMethod` is fixed at `ai_proposed_reviewed`
 * rather than accepted from the caller: this port exists for exactly one
 * lane, and letting a caller name a different authoring method here would
 * let AI output be recorded as human-authored or as extracted from a source
 * that does not exist.
 */
export interface TaxonomySeasonalFactProposalInput {
  readonly id: Uuid;
  readonly taxonomyReferenceId: Uuid;
  readonly hemisphere: Hemisphere;
  readonly sowIndoorsStartMonth: number | null;
  readonly sowIndoorsEndMonth: number | null;
  readonly sowOutdoorsStartMonth: number | null;
  readonly sowOutdoorsEndMonth: number | null;
  readonly transplantStartMonth: number | null;
  readonly transplantEndMonth: number | null;
  readonly harvestStartMonth: number | null;
  readonly harvestEndMonth: number | null;
  readonly daysToMaturityMin: number | null;
  readonly daysToMaturityMax: number | null;
  readonly successionIntervalDays: number | null;
  readonly rotationRestSeasons: number | null;
}

/**
 * One queue entry: the fact plus the taxon name a person needs to judge it.
 * Without the name the queue would be a list of UUIDs and month numbers,
 * which is not reviewable content.
 */
export interface TaxonomySeasonalFactReviewItem {
  readonly fact: TaxonomySeasonalFact;
  readonly scientificName: string;
  readonly commonName: string | null;
}
