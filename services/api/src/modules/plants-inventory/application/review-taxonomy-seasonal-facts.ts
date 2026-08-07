/**
 * The horticultural review queue for seasonal timing, and its one mutation.
 *
 * WHY THIS EXISTS. Three rules — sowing windows, succession replanting and
 * crop rotation — read only `horticulturally_reviewed` seasonal facts, and
 * the repository treats an unreviewed row as absent. That filter is the
 * safety control ADR-0013 and the safety catalog both require: no agent and
 * no engineer can sign off horticultural content, so unreviewed timing must
 * be unreadable rather than merely flagged.
 *
 * Until now there was no way for a reviewer to ACT on that. Content could
 * be authored but never promoted, which made the control indistinguishable
 * from a dead end. These two use cases are the missing half: the queue a
 * reviewer works through, and the sign-off that makes a row readable.
 *
 * `reviewedBy` is always the CALLING actor's own verified email, never a
 * caller-supplied string — a reviewer can only record THEMSELVES as having
 * reviewed something. That is what makes `reviewed_by` an accountable
 * claim rather than a decorative field, and it is the same posture
 * `ApprovePlantAssertionReview` takes for its own queue.
 *
 * APPROVE IS THE ONLY TRANSITION. The table's own CHECK admits exactly two
 * review states, so there is nothing to reject INTO; a reviewer approves a
 * row or leaves it pending. Correcting bad content is authoring, not
 * reviewing, and belongs to whatever writes rows — the same honest scope
 * `ApprovePlantAssertionReview` settled on for the identical schema shape.
 *
 * Authorization reuses `integrations`' own reviewer allowlist
 * (`PLANT_REVIEWER_EMAILS`) rather than inventing a second one: "reviewer"
 * is one role in this system, and a person trusted to sign off a plant fact
 * is the same person trusted to sign off when to sow it. A second list
 * would be a second thing to keep in sync and a second way to be wrong.
 *
 * Source: docs/architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
 * docs/development/recommendation-safety-catalog.md;
 * migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql.
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantReviewerActor } from '../../integrations/public.js';
import { requirePlantReviewerAccess } from '../../integrations/public.js';
import { validateTaxonomySeasonalReview } from '../domain/taxonomy-seasonal-fact.js';
import type {
  TaxonomySeasonalFactRepository,
  TaxonomySeasonalFactReviewItem,
} from './taxonomy-seasonal-fact-repository.js';

/** A queue page is a working set, not a browsable collection — the same cap-not-cursor choice the Today view makes. */
export const SEASONAL_REVIEW_QUEUE_DEFAULT_LIMIT = 25;
export const SEASONAL_REVIEW_QUEUE_MAX_LIMIT = 100;

export class ListTaxonomySeasonalFactsAwaitingReview {
  constructor(
    private readonly facts: TaxonomySeasonalFactRepository,
    private readonly reviewerEmails: readonly string[],
  ) {}

  async execute(
    actor: PlantReviewerActor,
    limit: number = SEASONAL_REVIEW_QUEUE_DEFAULT_LIMIT,
  ): Promise<readonly TaxonomySeasonalFactReviewItem[]> {
    requirePlantReviewerAccess(this.reviewerEmails, actor);
    const bounded = Math.min(Math.max(limit, 1), SEASONAL_REVIEW_QUEUE_MAX_LIMIT);
    return this.facts.listAwaitingReview(bounded);
  }
}

export type ApproveTaxonomySeasonalFactResult =
  | { readonly outcome: 'approved'; readonly reviewedBy: string; readonly reviewedOn: string }
  /** Not awaiting review anymore — signed off by someone else, or no such id. Indistinguishable on purpose: both mean "nothing left for this caller to approve", and separating them would let a probe confirm an id exists. */
  | { readonly outcome: 'alreadyReviewedOrMissing' };

export class ApproveTaxonomySeasonalFactReview {
  constructor(
    private readonly facts: TaxonomySeasonalFactRepository,
    private readonly reviewerEmails: readonly string[],
    private readonly clock: Clock,
  ) {}

  async execute(
    factId: Uuid,
    actor: PlantReviewerActor,
  ): Promise<ApproveTaxonomySeasonalFactResult> {
    requirePlantReviewerAccess(this.reviewerEmails, actor);
    // `requirePlantReviewerAccess` guarantees `actor.email` is defined here.
    const reviewedBy = (actor.email as string).toLowerCase();
    const reviewedOn = this.clock.now().toISOString().slice(0, 10);

    // Validated before writing — the domain decides the shape, the
    // repository stores it. This also re-checks the correlation the
    // migration's own CHECKs enforce, so a malformed sign-off fails here
    // with a clean error rather than as a constraint violation.
    validateTaxonomySeasonalReview({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy,
      reviewedOn,
    });

    const approved = await this.facts.approve(factId, reviewedBy, reviewedOn);
    return approved
      ? { outcome: 'approved', reviewedBy, reviewedOn }
      : { outcome: 'alreadyReviewedOrMissing' };
  }
}
