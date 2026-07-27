/**
 * The rule engine's input: one garden's structured facts, exactly the
 * section-4 input list ("Structured Inputs") as typed data — assembled by
 * `EvaluateGardenRecommendations` from the owning modules' own read
 * surfaces, never queried by the engine itself, so `evaluateGardenRules`
 * stays a pure function ("Rules execute deterministically for the same
 * versioned inputs", section 5).
 *
 * Missing facts remain missing (section 4): every optional input is an
 * explicit `'missing'` variant or `null`, never a default. A rule that
 * needs an absent fact does not fire — the engine records a typed skip,
 * not an invented value.
 *
 * The fact shapes deliberately carry only what a launch rule can consult.
 * Section 4 inputs with no backing data anywhere in this repository today
 * (soil or moisture facts, user preferences and capability constraints,
 * garden geometry and exposure) have no fact field at all — adding a field
 * no code path can populate would be the invented-value mistake one level
 * up. Each arrives with the stage that first stores it.
 *
 * P9D-SEASON-RULES-01 adds three fact shapes for the seasonal rules
 * (`taxonomyReferenceId`/`gardenAreaMapObjectId` on `PlantFact`,
 * `TaxonomyFact`, `PriorBedOccupantFact`) — every one of them a value
 * `gatherGardenFacts` already had within reach (a field on the `Plant`
 * record already being read, or a query bound only by facts already
 * gathered), never a new independent lookup a rule could not justify.
 *
 * Source: architecture/recommendations-and-ai.md, sections "4. Structured
 * Inputs" and "5. Rule Engine".
 */

import type { Position } from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { WeatherFreshness, WeatherRecordKind } from '../../integrations/public.js';
import type {
  LifecycleStage,
  PlantStatus,
  TaxonomySeasonalFact,
} from '../../plants-inventory/public.js';
import type { RecommendationTarget } from './recommendation-candidate.js';
import type { RecommendationCandidateState } from './recommendation-lifecycle.js';

/**
 * The two-value vocabulary `plants_inventory`'s `Hemisphere`
 * (domain/taxonomy-seasonal-fact.ts) also carries — kept as an independent
 * literal type here rather than a cross-module import, the same reasoning
 * that file's own header gives: a trivial two-value string union each
 * module already owns its own copy of.
 */
export type Hemisphere = 'northern' | 'southern';

/** One plant's rule-relevant facts — "Plant identity", "Plant lifecycle stage" (section 4). */
export interface PlantFact {
  readonly plantId: Uuid;
  readonly displayName: string;
  readonly lifecycleStage: LifecycleStage;
  readonly status: PlantStatus;
  /** When the plant record entered the system — the observation-recency baseline for a plant never observed. */
  readonly createdAt: Date;
  /**
   * P9D-SEASON-RULES-01: the plant's own identification, straight off the
   * `Plant` record `gatherGardenFacts` already reads per plant — not a new
   * query. `null` for a plant never identified (or an identification
   * explicitly cleared). The key that joins a plant to its `TaxonomyFact`
   * below (family, reviewed seasonal timing) and, transitively, to whether
   * a seasonal rule can say anything about it at all: "unknown taxonomy"
   * is a typed skip for every seasonal rule, never a guess.
   */
  readonly taxonomyReferenceId: Uuid | null;
  /**
   * P9D-SEASON-RULES-01: the plant's own current bed placement, the same
   * "thread the existing `Plant` field through" reasoning as
   * `taxonomyReferenceId` above. Not requested by name in this stage's
   * brief (only `taxonomyReferenceId` was), but added for the same reason:
   * `crop-rotation-caution` needs to distinguish "this plant has no bed
   * placement at all" (`plant.not_placed`, a real and different condition)
   * from "placed, but this bed's occupancy history carries no known
   * conflict" — two facts a single omitted field could not tell apart
   * without either fabricating a placement or collapsing two distinct
   * skip reasons into one dishonest one. See `PriorBedOccupantFact` below
   * for the derived fact this field keys into.
   */
  readonly gardenAreaMapObjectId: Uuid | null;
}

/**
 * One taxon's rule-relevant reference facts, keyed by `taxonomyReferenceId`
 * — P9D-SEASON-RULES-01. Populated once per DISTINCT taxon actually
 * referenced by this garden's own plants (never a catalog-wide dump), by
 * `gatherGardenFacts` joining `plants-inventory`'s `TaxonomyReferenceRepository
 * .findById` (family) and `TaxonomySeasonalFactRepository
 * .findReviewedForTaxonomyAndHemisphere` (the reviewed seasonal timing fact,
 * for the SAME garden-wide `hemisphere` this record already carries) —
 * see `evaluate-garden-recommendations.ts`'s own header for why this
 * assembly happens INSIDE the transaction rather than pre-fetched like
 * weather/hemisphere.
 *
 * Bundles both family (`crop-rotation-caution`'s own input) and the
 * reviewed seasonal fact (`seasonal-sowing-window-check`'s and
 * `succession-replanting-reminder`'s shared input) in one record rather
 * than two separate per-taxon arrays: every rule that needs one of these
 * facts about a taxon needs to know "is this taxon catalogued at all" only
 * once, and the two facts are always fetched together in practice (the
 * same `taxonomyReferenceId` loop in `gatherGardenFacts`).
 */
export interface TaxonomyFact {
  readonly taxonomyReferenceId: Uuid;
  /** `null` when the taxon has no catalogued family yet — "unknown stays unknown", the same latitude `TaxonomyReference.family` itself takes. */
  readonly family: string | null;
  /**
   * The garden's own hemisphere's `horticulturally_reviewed` seasonal
   * fact for this taxon, or `null` when none exists — row absent, or the
   * only row present is still `awaiting_horticultural_review` (the
   * repository's own filter; never re-applied or second-guessed here).
   * Reused as-is (not re-shaped) since every field a seasonal rule needs
   * is already present on it.
   */
  readonly seasonalFact: TaxonomySeasonalFact | null;
}

/**
 * One plant's most recent DEPARTED (non-self) occupant of its own current
 * bed, derived from `BedOccupancyHistoryReader.findForBed` —
 * `crop-rotation-caution`'s (P9D-SEASON-RULES-01) sole input beyond
 * `TaxonomyFact`. See `evaluate-garden-recommendations.ts` for the exact
 * reconstruction: the segment (excluding the plant's own) with the latest
 * `occupiedUntil` at or before `evaluatedAt`, within a generous fixed
 * lookback window.
 *
 * Present only for a plant with a known `gardenAreaMapObjectId` AND a
 * known own family (gathering skips the query otherwise — nothing this
 * rule could do with either fact missing, see `PlantFact
 * .gardenAreaMapObjectId`'s own doc comment for the distinct-skip-reasons
 * argument). `priorFamily`/`priorOccupancyEndedAt` are themselves BOTH
 * `null` together exactly when no departed occupant was found in the
 * lookback window (a new bed, or one whose entire history predates the
 * window) — "no known conflict" is itself a legitimate, honest outcome,
 * not an error. A departed occupant whose OWN taxonomy is unidentified
 * carries `priorFamily: null` with a real `priorOccupancyEndedAt` — a
 * known departure, an unknown family; the rule reads this the same as "no
 * known conflict" (never assumes a match it cannot prove).
 */
export interface PriorBedOccupantFact {
  readonly plantId: Uuid;
  readonly gardenAreaMapObjectId: Uuid;
  readonly priorFamily: string | null;
  readonly priorOccupancyEndedAt: Date | null;
}

/** One observation's rule-relevant facts — "Recent observations" (section 4). Correction rows count like any other row: a correction is itself an act of checking the plant. */
export interface ObservationFact {
  readonly observationId: Uuid;
  /** Null for garden- or area-level observations not tied to one plant. */
  readonly plantId: Uuid | null;
  readonly observedAt: Date;
}

/**
 * One open (`'planned'`/`'suggested'`) task's rule-relevant facts —
 * "Recent ... tasks" (section 4) and the "Existing task overlap" priority
 * input (section 7). `originRuleKey` is the rule key of the recommendation
 * candidate the task was converted from (`task.origin_recommendation_id`
 * joined through `rule_version`), or `null` for a manual task — the one
 * link that makes task equivalence PROVABLE for duplicate suppression; see
 * `rule-evaluation.ts`.
 */
export interface OpenTaskFact {
  readonly taskId: Uuid;
  readonly target: RecommendationTarget;
  readonly originRuleKey: string | null;
}

/** The measurements a weather-dependent rule may consult — each nullable, mirroring `integrations`' own normalized record ("Missing facts remain missing" applies to provider data too). */
export interface WeatherMeasurementFacts {
  readonly temperatureCelsius: number | null;
  readonly precipitationMm: number | null;
  readonly windSpeedMps: number | null;
  readonly humidityPercent: number | null;
}

/**
 * The garden's latest stored weather of one kind, as
 * `GetGardenWeather`'s two outcomes made typed facts: `'missing'` is that
 * use case's `noRecord` (today's reality for every garden — no provider is
 * configured), `'available'` carries the read-time freshness label the
 * engine's degradation rules branch on ("Weather observations and forecast
 * freshness", section 4).
 */
export type WeatherFact =
  | { readonly availability: 'missing' }
  | {
      readonly availability: 'available';
      readonly weatherRecordId: Uuid;
      readonly kind: WeatherRecordKind;
      readonly freshness: WeatherFreshness;
      /** The moment the reading is about (observation time, or forecast target time). */
      readonly effectiveAt: Date;
      readonly measurements: WeatherMeasurementFacts;
    };

/** Everything a rule may consult about one garden, plus the injected evaluation instant — the engine's single source of "now". */
export interface GardenFacts {
  readonly gardenId: Uuid;
  /** The injected clock's reading at fact-gathering time. The engine never reads a clock itself. */
  readonly evaluatedAt: Date;
  readonly plants: readonly PlantFact[];
  readonly observations: readonly ObservationFact[];
  readonly openTasks: readonly OpenTaskFact[];
  readonly weatherObservation: WeatherFact;
  readonly weatherForecast: WeatherFact;
  /**
   * P9D-SEASON-DATA-01: derived from the garden's current georeference
   * (`GeoreferenceRepository.findCurrentForGarden`), never guessed — `null`
   * when the garden has never been georeferenced. Consumed by
   * `seasonal-sowing-window-check`, `succession-replanting-reminder`, and
   * `crop-rotation-caution` (P9D-SEASON-RULES-01) — every one of them
   * treats a `null` hemisphere as a whole-rule typed skip, since none of
   * them can resolve a taxon's reviewed seasonal fact without it.
   */
  readonly hemisphere: Hemisphere | null;
  /**
   * P9D-SEASON-RULES-01: one entry per DISTINCT `taxonomyReferenceId`
   * actually carried by `plants` above — see `TaxonomyFact`'s own doc
   * comment for what each entry holds and why family and the reviewed
   * seasonal fact are bundled together. Look up with `taxonomyFactFor`.
   */
  readonly taxonomyFacts: readonly TaxonomyFact[];
  /**
   * P9D-SEASON-RULES-01: `crop-rotation-caution`'s sole additional input —
   * see `PriorBedOccupantFact`'s own doc comment for population rules.
   * Look up with `priorBedOccupantFor`.
   */
  readonly priorBedOccupants: readonly PriorBedOccupantFact[];
}

/**
 * One prior candidate's suppression-relevant facts, joined with its rule
 * identity — the engine's window into what earlier evaluations already
 * produced. `revision` rides along so a supersession decision can carry
 * the optimistic-concurrency guard the persistence update needs.
 */
export interface PriorCandidateFact {
  readonly candidateId: Uuid;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly state: RecommendationCandidateState;
  readonly revision: number;
  readonly target: RecommendationTarget;
  readonly windowEnd: Date | null;
  readonly createdAt: Date;
  /**
   * The user's re-surfacing horizon from the latest `postponed` feedback
   * row, when this candidate is `postponed` and the user named one; `null`
   * otherwise (including a horizon-less postponement — the feedback row's
   * own nullable posture). Drives the engine's postponed-prior re-surfacing
   * rule (P7-BE-01) — see `rule-evaluation.ts`.
   */
  readonly postponedUntil: Date | null;
}

/**
 * The engine's second input: prior engine output, read in the same
 * transaction that will persist this evaluation's own — duplicate
 * suppression and supersession are decided against a snapshot that cannot
 * drift mid-evaluation.
 */
export interface PriorRecommendationState {
  /** Every candidate still in a live (non-terminal) state. */
  readonly liveCandidates: readonly PriorCandidateFact[];
  /** The most recently created candidate per (rule key, target), regardless of state — the recurrence-interval baseline. */
  readonly latestPerRuleAndTarget: readonly PriorCandidateFact[];
}

/** Target identity for suppression comparisons: same kind, same referenced object — the definition `rule-evaluation.ts`'s equivalence rules build on. */
export function sameRecommendationTarget(
  a: RecommendationTarget,
  b: RecommendationTarget,
): boolean {
  return (
    a.kind === b.kind &&
    a.gardenAreaMapObjectId === b.gardenAreaMapObjectId &&
    a.plantId === b.plantId
  );
}

/** The most recent observation fact for one plant, or `null` when the plant has never been observed — a derived fact, not an invented one. */
export function latestObservationForPlant(
  observations: readonly ObservationFact[],
  plantId: Uuid,
): ObservationFact | null {
  let latest: ObservationFact | null = null;
  for (const observation of observations) {
    if (observation.plantId !== plantId) {
      continue;
    }
    if (latest === null || observation.observedAt.getTime() > latest.observedAt.getTime()) {
      latest = observation;
    }
  }
  return latest;
}

/** The taxon's reference facts (family, reviewed seasonal fact), or `null` when this garden's plants never referenced that taxon — mirrors `latestObservationForPlant`'s own lookup-over-array shape. */
export function taxonomyFactFor(
  facts: GardenFacts,
  taxonomyReferenceId: Uuid,
): TaxonomyFact | null {
  return (
    facts.taxonomyFacts.find((fact) => fact.taxonomyReferenceId === taxonomyReferenceId) ?? null
  );
}

/** The plant's most recent departed bed occupant fact, or `null` when none was gathered for this plant (no bed placement, no known own family, or the query genuinely found nothing — see `PriorBedOccupantFact`'s own doc comment for how to tell those apart). */
export function priorBedOccupantFor(
  facts: GardenFacts,
  plantId: Uuid,
): PriorBedOccupantFact | null {
  return facts.priorBedOccupants.find((occupant) => occupant.plantId === plantId) ?? null;
}

/**
 * Derives `GardenFacts.hemisphere` from a garden's current georeference
 * anchor: `null` in (never georeferenced) yields `null` out — never
 * guessed. Otherwise the sign of `geographicAnchor[1]` (latitude; `Position`
 * is `[longitude, latitude]`, the GeoJSON convention
 * `@verdery/geometry-contracts` already follows throughout).
 *
 * EQUATOR EDGE CASE (latitude exactly `0`), a genuine ambiguity
 * tasks/todo.md's own design does not resolve: this function resolves it as
 * `'northern'`. Conservative and consistent with how this codebase treats
 * boundary comparisons elsewhere (`plant_quantity_positive_check`-style
 * strict `>`/`<` pairs, `windowEnd`-inclusive checks): a `>= 0` test is a
 * single, total, side-free comparison, whereas special-casing `=== 0` into a
 * third `null`/"equatorial" outcome would invent a state no launch rule or
 * schema anywhere in this codebase asks for, for a coordinate that will
 * essentially never occur from a real address geocode.
 */
export function deriveHemisphere(geographicAnchor: Position | null): Hemisphere | null {
  if (geographicAnchor === null) {
    return null;
  }
  const latitude = geographicAnchor[1];
  return latitude >= 0 ? 'northern' : 'southern';
}
