/**
 * P11-PROV-01: the reviewer queue's own mutation — promotes one fact or
 * distribution assertion from `awaiting_horticultural_review` to
 * `horticulturally_reviewed`. This is the ONLY transition this command
 * offers: no `rejected` review state exists in either table's own CHECK
 * constraint (`migrations/1787700000000_plant-taxon-knowledge-profile.sql`),
 * so there is nothing to reject INTO — a first-pass reviewer surface
 * approves or leaves an assertion pending, matching the honest scope this
 * migration already committed to.
 *
 * `reviewedBy` is always the CALLING actor's own verified email, never a
 * caller-supplied string — a reviewer can only ever record themselves as
 * having reviewed something, the same "the actor context is the only
 * identity a use case trusts" posture every other authenticated mutation in
 * this codebase takes.
 *
 * Validates through `validatePlantAssertionReview` before writing — "the
 * domain decides, the repository stores", the same split
 * `PlantTaxonomyMappingRepository.updateVerificationState`'s own header
 * documents for `validateMappingStateTransition`.
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { validatePlantAssertionReview } from '../domain/plant-assertion-provenance.js';
import type { PlantDistributionAssertionRepository } from './plant-distribution-assertion-repository.js';
import type { PlantFactAssertionRepository } from './plant-fact-assertion-repository.js';
import type { PlantReviewerActor } from './plant-reviewer-authorization.js';
import { requirePlantReviewerAccess } from './plant-reviewer-authorization.js';

export type PlantAssertionKind = 'fact' | 'distribution';

export interface ApprovePlantAssertionReviewInput {
  readonly kind: PlantAssertionKind;
  readonly assertionId: Uuid;
}

export type ApprovePlantAssertionReviewResult =
  | { readonly outcome: 'approved' }
  /** The row is not `awaiting_horticultural_review` anymore — already reviewed by someone else, or the id does not exist. Indistinguishable on purpose: both mean "there is nothing left for this caller to approve". */
  | { readonly outcome: 'alreadyReviewedOrMissing' };

export class ApprovePlantAssertionReview {
  constructor(
    private readonly factAssertions: PlantFactAssertionRepository,
    private readonly distributionAssertions: PlantDistributionAssertionRepository,
    private readonly reviewerEmails: readonly string[],
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ApprovePlantAssertionReviewInput,
    actor: PlantReviewerActor,
  ): Promise<ApprovePlantAssertionReviewResult> {
    requirePlantReviewerAccess(this.reviewerEmails, actor);
    // `requirePlantReviewerAccess` guarantees `actor.email` is defined here.
    const reviewedBy = (actor.email as string).toLowerCase();
    const reviewedOn = this.clock.now().toISOString().slice(0, 10);

    const review = validatePlantAssertionReview({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy,
      reviewedOn,
    });
    // `validatePlantAssertionReview` only narrows the TYPE for this branch;
    // it cannot fail to be 'horticulturally_reviewed' here since that is
    // the literal reviewStatus this command always requests.
    if (review.reviewStatus !== 'horticulturally_reviewed') {
      throw new Error('unreachable: requested review is always horticulturally_reviewed');
    }

    const repository = input.kind === 'fact' ? this.factAssertions : this.distributionAssertions;
    const applied = await repository.approveReview(
      input.assertionId,
      review.reviewedBy,
      review.reviewedOn,
    );
    return { outcome: applied ? 'approved' : 'alreadyReviewedOrMissing' };
  }
}
