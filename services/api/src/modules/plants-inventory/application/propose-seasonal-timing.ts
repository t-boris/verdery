/**
 * Drafts seasonal timing for taxa a garden actually grows but nobody has
 * timing for — ADR-0013's proposal lane, wired to the gap the care-rules
 * surface reports as `seasonalTimingNotAccepted`.
 *
 * WHY A SWEEP AND NOT A REQUEST. ADR-0013 permits proposals as "a bulk
 * offline authoring pass" and forbids the model from being consulted
 * during a user request. Adding a plant therefore does not call Vertex;
 * it makes that plant's taxon eligible for the next pass. That keeps the
 * add-a-plant path free of provider latency, provider outages and provider
 * spend, which is exactly why the boundary is drawn there.
 *
 * INERT BY CONSTRUCTION. Everything written lands
 * `awaiting_horticultural_review`, which `findReviewedForTaxonomyAndHemisphere`
 * treats as absent. A proposal changes no recommendation, and the only way
 * out of the queue is a named reviewer's sign-off. ADR-0013: "Proposals are
 * inert. They are not readable by the rule engine, not visible to
 * gardeners, and not exportable until a human reviewer accepts or corrects
 * them."
 *
 * BOUNDED THE SAME WAY EVERY PROVIDER CALL HERE IS: a strict per-call
 * deadline, quota consumed before the call rather than after, and a
 * per-run candidate cap. A typed `quotaExhausted` stops the batch honestly
 * instead of grinding through refusals — every later candidate would spend
 * and fail against the same exhausted budget.
 *
 * DECLINE IS A SUCCESS. A model that will not claim timing for a taxon
 * produces no row and no retry pressure. Writing an all-null proposal
 * would put something in a reviewer's queue that has nothing in it to
 * review.
 *
 * Source: ADR-0013-ai-assisted-care-content-authoring.md;
 * architecture/external-integrations.md, sections "11. Reliability" and
 * "14. Cost and Quota".
 */

import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  ProviderQuotaLimits,
  ProviderQuotaRepository,
  SeasonalTimingProposalProvider,
} from '../../integrations/public.js';
import { withDeadline } from '../../integrations/public.js';
import type { Hemisphere } from '../domain/taxonomy-seasonal-fact.js';
import type { TaxonomySeasonalFactRepository } from './taxonomy-seasonal-fact-repository.js';

/**
 * Per-run ceiling. Small on purpose: this is speculative authoring whose
 * output a human must then read, so a run that outpaces review throughput
 * only grows a backlog — and the queue's own value falls as it grows.
 */
export const SEASONAL_PROPOSAL_BATCH_LIMIT = 10;

/** One taxon a garden grows that has no seasonal fact for its hemisphere. */
export interface SeasonalProposalCandidate {
  readonly taxonomyReferenceId: Uuid;
  readonly scientificName: string;
  readonly commonName: string | null;
  readonly family: string | null;
  readonly hemisphere: Hemisphere;
}

/** Selects taxa worth proposing for — see `KyselySeasonalProposalCandidateSource`. */
export interface SeasonalProposalCandidateSource {
  listCandidates(limit: number): Promise<readonly SeasonalProposalCandidate[]>;
}

export interface ProposeSeasonalTimingResult {
  readonly considered: number;
  readonly proposed: number;
  /** The model declined to claim timing — a legitimate outcome, counted rather than retried. */
  readonly declined: number;
  /** A row already existed for that taxon and hemisphere by the time the insert ran. */
  readonly alreadyPresent: number;
  readonly unavailable: number;
  readonly stoppedOnQuotaExhaustion: boolean;
}

export class ProposeSeasonalTiming {
  constructor(
    /** `null` when the capability is switched off — the phase then does not exist and no client is constructed. */
    private readonly provider: SeasonalTimingProposalProvider | null,
    private readonly candidates: SeasonalProposalCandidateSource,
    private readonly facts: TaxonomySeasonalFactRepository,
    private readonly quotas: ProviderQuotaRepository,
    private readonly configuration: {
      readonly providerKey: string;
      readonly callTimeoutMs: number;
      readonly quotaLimits: ProviderQuotaLimits;
    },
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<ProposeSeasonalTimingResult> {
    const empty: ProposeSeasonalTimingResult = {
      considered: 0,
      proposed: 0,
      declined: 0,
      alreadyPresent: 0,
      unavailable: 0,
      stoppedOnQuotaExhaustion: false,
    };
    if (this.provider === null) {
      return empty;
    }

    const candidates = await this.candidates.listCandidates(SEASONAL_PROPOSAL_BATCH_LIMIT);
    let considered = 0;
    let proposed = 0;
    let declined = 0;
    let alreadyPresent = 0;
    let unavailable = 0;

    for (const candidate of candidates) {
      // Consumed BEFORE the call, so a crash mid-call cannot leave the
      // budget unspent and the provider billed — the posture every other
      // provider call in this codebase takes.
      const quota = await this.quotas.consumeCall(
        this.configuration.providerKey,
        this.configuration.quotaLimits,
        this.clock.now(),
      );
      if (!quota.consumed) {
        return {
          considered,
          proposed,
          declined,
          alreadyPresent,
          unavailable,
          stoppedOnQuotaExhaustion: true,
        };
      }

      considered += 1;
      const provider = this.provider;
      const outcome = await withDeadline(this.configuration.callTimeoutMs, (signal) =>
        provider.proposeSeasonalTiming(
          {
            scientificName: candidate.scientificName,
            commonName: candidate.commonName,
            family: candidate.family,
            hemisphere: candidate.hemisphere,
          },
          signal,
        ),
      );

      if (outcome.kind !== 'completed') {
        unavailable += 1;
        continue;
      }
      if (outcome.value.kind === 'declined') {
        declined += 1;
        continue;
      }
      if (outcome.value.kind === 'unavailable') {
        unavailable += 1;
        continue;
      }

      const inserted = await this.facts.insertProposal({
        id: generateUuidV7(),
        taxonomyReferenceId: candidate.taxonomyReferenceId,
        hemisphere: candidate.hemisphere,
        ...outcome.value.draft,
      });
      if (inserted) {
        proposed += 1;
      } else {
        alreadyPresent += 1;
      }
    }

    return {
      considered,
      proposed,
      declined,
      alreadyPresent,
      unavailable,
      stoppedOnQuotaExhaustion: false,
    };
  }
}
