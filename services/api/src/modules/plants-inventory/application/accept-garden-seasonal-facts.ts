/**
 * The seasonal-timing acceptance queue for one garden, and its one mutation.
 *
 * WHY THIS EXISTS. Three rules — sowing windows, succession replanting and
 * crop rotation — read only seasonal timing a garden has accepted, and the
 * repository treats an unaccepted fact as absent. That filter is the safety
 * control ADR-0013 and the safety catalog require: AI-proposed and
 * source-extracted timing must not reach a gardener until a person decided
 * to use it.
 *
 * WHAT REPLACED WHAT. The control used to be a single global sign-off by a
 * named horticulturist drawn from `PLANT_REVIEWER_EMAILS`. That allowlist
 * was never wired through to the deployed service, so it was empty, no row
 * could ever be promoted, and the three rules were silent everywhere,
 * permanently. A control nobody can operate is not a stricter control; it is
 * an absent feature with a comment explaining why.
 *
 * WHY THE GARDEN'S OWNER OR EDITOR MAY DECIDE. `taxonomy_seasonal_fact` has
 * no `garden_id` — the timing content is shared. So the authority granted
 * here is deliberately NOT "mark this content reviewed"; it is "use this
 * content in MY garden", recorded in `garden_seasonal_fact_acceptance`. A
 * decision reaches exactly the garden whose owner made it, which is a scope
 * that person already controls. Granting the global status instead would
 * have published one gardener's judgment into every other garden — the very
 * authority the horticulturist gate existed to withhold.
 *
 * `editGardenContent` is the capability, not a new one: it already means
 * exactly "owner and editor" (`gardens-mapping/domain/garden-role.ts`), and
 * a viewer is refused by it. Inventing a second membership concept for this
 * one decision would be a second thing to keep in sync with the first.
 *
 * `acceptedByProfileId` is always the CALLING actor's own profile, never a
 * caller-supplied value — a person can only record THEMSELVES as having
 * accepted something. That is what makes the column an accountable claim
 * rather than decoration, the same posture `ApprovePlantAssertionReview`
 * takes for its own queue.
 *
 * ACCEPT IS THE ONLY TRANSITION. There is nothing to reject into: a fact a
 * garden has not accepted is already unreadable by the rules, so declining
 * is simply not accepting. Correcting bad timing is authoring, not
 * accepting, and belongs to whatever writes facts.
 *
 * Source: docs/architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
 * docs/development/recommendation-safety-catalog.md;
 * migrations/1789700000000_garden-seasonal-fact-acceptance.sql.
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GardenHemisphereSource } from './garden-hemisphere-source.js';
import type {
  TaxonomySeasonalFactRepository,
  TaxonomySeasonalFactReviewItem,
} from './taxonomy-seasonal-fact-repository.js';

/** A queue page is a working set, not a browsable collection — the same cap-not-cursor choice the Today view makes. */
export const SEASONAL_ACCEPTANCE_QUEUE_DEFAULT_LIMIT = 25;
export const SEASONAL_ACCEPTANCE_QUEUE_MAX_LIMIT = 100;

/**
 * Empty when the garden has no hemisphere yet. That is not an error and not
 * an empty backlog: sowing months are meaningless without knowing which half
 * of the world the garden is in, so there is genuinely nothing to decide
 * about until the garden is located. The caller distinguishes the two so the
 * reader is told which one they are looking at.
 */
export interface GardenSeasonalAcceptanceQueue {
  readonly hemisphereKnown: boolean;
  readonly items: readonly TaxonomySeasonalFactReviewItem[];
}

export class ListGardenSeasonalFactsAwaitingAcceptance {
  constructor(
    private readonly facts: TaxonomySeasonalFactRepository,
    private readonly authorization: GardenAuthorization,
    private readonly hemispheres: GardenHemisphereSource,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    limit: number = SEASONAL_ACCEPTANCE_QUEUE_DEFAULT_LIMIT,
  ): Promise<GardenSeasonalAcceptanceQueue> {
    // Read access is not enough: this queue exists to be acted on, and
    // showing a viewer a list of buttons they cannot press is worse than
    // showing them nothing.
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const hemisphere = await this.hemispheres.findHemisphere(gardenId);
    if (hemisphere === null) {
      return { hemisphereKnown: false, items: [] };
    }

    const bounded = Math.min(Math.max(limit, 1), SEASONAL_ACCEPTANCE_QUEUE_MAX_LIMIT);
    return {
      hemisphereKnown: true,
      items: await this.facts.listAwaitingAcceptanceForGarden(gardenId, hemisphere, bounded),
    };
  }
}

export type AcceptGardenSeasonalFactResult =
  | { readonly outcome: 'accepted'; readonly acceptedOn: string }
  /** No such fact, or its hemisphere is not this garden's. Indistinguishable on purpose: both mean "there is nothing here for this garden to accept", and separating them would let a probe confirm an id exists. */
  | { readonly outcome: 'notAcceptableHere' }
  /** The garden has no hemisphere, so no timing can apply to it yet. */
  | { readonly outcome: 'hemisphereUnknown' };

export class AcceptGardenSeasonalFact {
  constructor(
    private readonly facts: TaxonomySeasonalFactRepository,
    private readonly authorization: GardenAuthorization,
    private readonly hemispheres: GardenHemisphereSource,
    private readonly uuid: { create(): Uuid },
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    factId: Uuid,
    profileId: Uuid,
  ): Promise<AcceptGardenSeasonalFactResult> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const hemisphere = await this.hemispheres.findHemisphere(gardenId);
    if (hemisphere === null) {
      return { outcome: 'hemisphereUnknown' };
    }

    const acceptedOn = this.clock.now().toISOString().slice(0, 10);
    // The hemisphere is passed down and re-checked against the fact's own
    // column in SQL, so a fact for the other half of the world cannot be
    // accepted here by id — its months would be inverted for this garden.
    const accepted = await this.facts.acceptForGarden({
      id: this.uuid.create(),
      gardenId,
      taxonomySeasonalFactId: factId,
      acceptedByProfileId: profileId,
      acceptedOn,
      hemisphere,
    });

    return accepted ? { outcome: 'accepted', acceptedOn } : { outcome: 'notAcceptableHere' };
  }
}
