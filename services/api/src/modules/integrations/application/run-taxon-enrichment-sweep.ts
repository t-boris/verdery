/**
 * `RunTaxonEnrichmentSweep` (P11-ASYNC-01): one bounded pass over the taxa
 * that need enrichment, calling `RefreshTaxonAssertions` once per
 * configured provider key and then `RebuildPlantProfileVersion` — the
 * scheduled caller both use cases were built for, the exact
 * `RunWeatherRefreshSweep` shape applied to a second knowledge domain.
 *
 * WHERE THIS RUNS, AND WHY: in `services/api`, triggered by an authenticated
 * internal endpoint the worker's own interval scheduler calls — the exact
 * `RunWeatherRefreshSweep`/`run-media-retention-sweep.ts` shape, for the
 * identical privilege reasoning (`verdery_worker` has no access to
 * `integrations.*`/`plants_inventory.*`).
 *
 * WHY NOT LITERAL CLOUD TASKS/CLOUD RUN JOBS: ADR-0016 section 5 names
 * "genuinely new Cloud Tasks/Cloud Run Job machinery" as this stage's
 * infrastructure. This codebase has NO existing Cloud Scheduler convention
 * and no other sweep — media retention, weather refresh, recommendation
 * evaluation, notification delivery, deletion — uses one either;
 * `sweep-trigger.ts`'s own header states this explicitly: "a process that
 * is already awake on an interval... no Cloud Scheduler convention exists
 * in this codebase yet." Every one of those five sweeps runs on the SAME
 * worker-interval-plus-authenticated-HTTP-route shape this sweep now uses
 * as its sixth instance — real, tested, already in production use, unlike
 * an unbuilt, untestable-in-this-environment Cloud Run Job with no
 * Scheduler to trigger it. A literal Cloud Tasks/Cloud Run Job migration
 * for every sweep (including this one) remains a genuine, tracked
 * infrastructure gap — not silently dropped, not invented around; see
 * `tasks/todo.md`'s own P11-ASYNC-01 review section.
 *
 * SOURCE PRIORITY DOES DOUBLE DUTY: `sourcePriority` names both WHICH
 * registered providers this sweep attempts a fetch against for each
 * candidate taxon, in order, AND the tie-break order handed to
 * `RebuildPlantProfileVersion` afterward — the same list, because ADR-0016's
 * selected-and-registered provider set IS the priority order; there is no
 * second, independently-configured list to keep in sync.
 *
 * Cost discipline, per taxon and per run: the batch cap bounds one run's
 * consideration; least-recently-materialized ordering (see
 * `taxon-enrichment-candidate-source.ts`) rotates fairly. A typed
 * `quotaExhausted` outcome from ANY provider stops the whole batch honestly
 * — the same "every later candidate would consume-and-refuse against the
 * same exhausted budget" reasoning `RunWeatherRefreshSweep`'s own header
 * documents. With zero providers configured (`sourcePriority: []`, honest
 * until a provider's kill-switch is enabled), every taxon's inner loop is a
 * no-op and `RebuildPlantProfileVersion` reports `nothingToResolve` for all
 * of them — a documented, observable no-op, never a crash.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  RefreshTaxonAssertionsInput,
  RefreshTaxonAssertionsResult,
  TaxonAssertionsUnavailableReason,
} from './refresh-taxon-assertions.js';
import type { TaxonEnrichmentCandidateSource } from './taxon-enrichment-candidate-source.js';

export const TAXON_ENRICHMENT_SWEEP_BATCH_LIMIT = 25;

/** The narrow slice of `RefreshTaxonAssertions` this sweep drives — structural, so tests fake it without the full constructor. */
export interface TaxonAssertionsRefresher {
  execute(input: RefreshTaxonAssertionsInput): Promise<RefreshTaxonAssertionsResult>;
}

/** The narrow slice of `RebuildPlantProfileVersion` this sweep drives. */
export interface PlantProfileVersionRebuilder {
  execute(
    taxonomyReferenceId: Uuid,
    sourcePriority: readonly string[],
  ): Promise<{ readonly outcome: 'rebuilt' | 'nothingToResolve' }>;
}

export interface TaxonEnrichmentSweepResult {
  /** Taxa this run actually considered. */
  readonly taxaConsidered: number;
  /** (taxon, provider) fetch-and-store calls that produced and persisted assertions. */
  readonly refreshed: number;
  /** Profile versions actually rebuilt (at least one reviewed fact resolved). */
  readonly profilesRebuilt: number;
  /** Taxa for which the rebuild had no reviewed or cited source-backed fact to resolve. */
  readonly profilesWithNothingToResolve: number;
  /** Degradation reasons across every (taxon, provider) attempt, by typed reason. */
  readonly degradationReasons: Readonly<Partial<Record<TaxonAssertionsUnavailableReason, number>>>;
  /** True when a typed `quotaExhausted` outcome stopped the batch before every candidate was considered. */
  readonly stoppedOnQuotaExhaustion: boolean;
  /** P11-OBS-01: "enrichment duration" — wall-clock time for this run's own DB/provider work, measured here (not by the worker's HTTP round-trip, which would also fold in network latency the sweep itself has no control over). */
  readonly durationMs: number;
  /**
   * ADR-0013's proposal phase, when it is switched on: seasonal timing
   * drafted into the review queue for taxa a garden grows and nobody has
   * timing for. `null` when the capability is off — the phase does not
   * exist and no provider call can happen, the same structural rollback
   * the AI-explanation phase's own `null` embellisher gives.
   */
  readonly seasonalProposals: SeasonalProposalPhaseResult | null;
}

/** The proposal phase's own counters — see `ProposeSeasonalTiming`. */
export interface SeasonalProposalPhaseResult {
  readonly considered: number;
  readonly proposed: number;
  readonly declined: number;
  readonly alreadyPresent: number;
  readonly unavailable: number;
  readonly stoppedOnQuotaExhaustion: boolean;
}

/** The narrow slice of `ProposeSeasonalTiming` this sweep drives — structural, so tests fake it without the full constructor. */
export interface SeasonalTimingProposer {
  execute(): Promise<SeasonalProposalPhaseResult>;
}

export class RunTaxonEnrichmentSweep {
  constructor(
    private readonly candidates: TaxonEnrichmentCandidateSource,
    private readonly refreshTaxonAssertions: TaxonAssertionsRefresher,
    private readonly rebuildPlantProfileVersion: PlantProfileVersionRebuilder,
    /** Ordered, most preferred first — see this file's own header on why one list serves both roles. */
    private readonly sourcePriority: readonly string[],
    private readonly clock: Clock,
    /**
     * ADR-0013's proposal phase. `null` = switched off: the phase is
     * skipped structurally and zero provider calls can happen.
     *
     * Runs LAST, after enrichment, deliberately: enrichment may have just
     * produced a reviewed fact for a taxon, and proposing timing for a
     * taxon that now has some would be spend on a queue entry a reviewer
     * would immediately discard.
     */
    private readonly proposeSeasonalTiming: SeasonalTimingProposer | null = null,
  ) {}

  async execute(): Promise<TaxonEnrichmentSweepResult> {
    const startedAt = this.clock.now();
    const taxonomyReferenceIds = await this.candidates.listEnrichmentCandidates(
      TAXON_ENRICHMENT_SWEEP_BATCH_LIMIT,
    );

    let taxaConsidered = 0;
    let refreshed = 0;
    let profilesRebuilt = 0;
    let profilesWithNothingToResolve = 0;
    const degradationReasons: Partial<Record<TaxonAssertionsUnavailableReason, number>> = {};
    let stoppedOnQuotaExhaustion = false;

    taxonLoop: for (const taxonomyReferenceId of taxonomyReferenceIds) {
      taxaConsidered += 1;

      for (const providerKey of this.sourcePriority) {
        const result = await this.refreshTaxonAssertions.execute({
          taxonomyReferenceId,
          providerKey,
        });

        if (result.outcome === 'refreshed') {
          refreshed += 1;
          continue;
        }

        degradationReasons[result.reason] = (degradationReasons[result.reason] ?? 0) + 1;
        if (result.reason === 'quotaExhausted') {
          stoppedOnQuotaExhaustion = true;
          break taxonLoop;
        }
      }

      const rebuildResult = await this.rebuildPlantProfileVersion.execute(
        taxonomyReferenceId,
        this.sourcePriority,
      );
      if (rebuildResult.outcome === 'rebuilt') {
        profilesRebuilt += 1;
      } else {
        profilesWithNothingToResolve += 1;
      }
    }

    // Last, and never allowed to fail the run: a drafting phase that
    // cannot reach its provider must not lose the enrichment work already
    // committed above. Its own degradations are typed counts in its own
    // summary, exactly like the AI-embellishment phase's.
    const seasonalProposals =
      this.proposeSeasonalTiming === null ? null : await this.proposeSeasonalTiming.execute();

    return {
      taxaConsidered,
      refreshed,
      profilesRebuilt,
      profilesWithNothingToResolve,
      degradationReasons,
      stoppedOnQuotaExhaustion,
      durationMs: this.clock.now().getTime() - startedAt.getTime(),
      seasonalProposals,
    };
  }
}
