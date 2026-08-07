/**
 * The automatic care rules, as they apply to one garden — the answer to "I
 * have no tasks", made checkable.
 *
 * WHY THIS EXISTS. Seven versioned rules decide what a garden needs, and
 * five of them can go silent for reasons that are invisible from outside:
 * no active weather provider, no coordinates, no identified plants, no
 * reviewed seasonal timing, nothing fetched yet. Every one of those
 * produces the same observable — an empty Today list — while having a
 * completely different answer, and two of them are things a person can fix
 * in one click. Collapsing them into silence leaves the likeliest reading
 * ("this is broken") wrong in every case.
 *
 * WHAT IT REPORTS, AND WHAT IT DELIBERATELY DOES NOT. It reports
 * PRECONDITIONS: facts a rule needs before it can say anything at all. It
 * does not predict whether a rule WOULD fire — that depends on thresholds,
 * plant stages and recurrence history, and answering it here would mean
 * reimplementing the engine's own decisions in a second place where they
 * could drift. "This rule has everything it needs" and "this rule is about
 * to fire" are different claims, and only the first is honest to make
 * without evaluating.
 *
 * READ-ONLY AND PROVIDER-FREE. It evaluates nothing, calls no provider and
 * writes nothing, so opening this list cannot change what the garden is
 * recommended and cannot spend quota. That matters for a page whose whole
 * purpose is diagnosis.
 *
 * `awaitingHorticulturalReview` is listed among the blockers deliberately,
 * even though it does not stop the rule from running. It is disclosure:
 * every launch rule's thresholds are defensible placeholders until a named
 * reviewer signs them off, and a surface that explains what the automation
 * does should not quietly omit that.
 *
 * Source: architecture/recommendations-and-ai.md, section "5. Rule Engine";
 * docs/development/recommendation-safety-catalog.md;
 * packages/api-contracts/openapi.yaml, operation `getGardenCareRules`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization, GeoreferenceReader } from '../../gardens-mapping/public.js';
import type { GetGardenPrecipitation, GetGardenWeather } from '../../integrations/public.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import type { RuleDefinition } from '../domain/rule-definition.js';

/** See the contract's own `CareRuleBlocker` for what each value means. */
export type CareRuleBlocker =
  | 'noWeatherProvider'
  | 'gardenNotGeoreferenced'
  | 'noWeatherObservation'
  | 'noWeatherForecast'
  | 'noRainfallHistory'
  | 'noIdentifiedPlants'
  | 'noReviewedSeasonalFacts'
  | 'noPlacedPlants'
  | 'awaitingHorticulturalReview';

export interface CareRuleResource {
  readonly ruleKey: string;
  readonly version: number;
  readonly careCategory: string;
  readonly safetyTier: 'ordinary_care' | 'elevated_risk';
  readonly urgency: 'low' | 'normal' | 'high' | 'urgent';
  readonly actionTitle: string;
  readonly description: string;
  readonly reviewStatus: 'awaiting_horticultural_review' | 'horticulturally_reviewed';
  readonly usesWeather: boolean;
  readonly blockers: CareRuleBlocker[];
}

export interface GardenCareRulesResource {
  readonly gardenId: Uuid;
  readonly rules: CareRuleResource[];
}

/**
 * The garden-level facts every rule's preconditions are judged against.
 * Gathered once and shared, because most of them block several rules at
 * the same time — a missing georeference alone silences five.
 */
interface GardenReadiness {
  readonly providerConfigured: boolean;
  readonly georeferenced: boolean;
  readonly hasObservation: boolean;
  readonly hasForecast: boolean;
  readonly hasRainfallHistory: boolean;
  readonly hasIdentifiedPlant: boolean;
  readonly hasReviewedSeasonalFact: boolean;
  readonly hasPlacedPlant: boolean;
}

/** The narrow read this use case needs about a garden's plants — see `GetGardenCareRules`'s constructor. */
export interface CareRulePlantReadinessSource {
  /** Whether the garden has at least one ACTIVE plant carrying a taxon, one placed in a garden area, and one whose taxon has a reviewed seasonal fact for the garden's own hemisphere. */
  readGardenPlantReadiness(
    gardenId: Uuid,
    hemisphere: 'northern' | 'southern' | null,
  ): Promise<{
    readonly hasIdentifiedPlant: boolean;
    readonly hasPlacedPlant: boolean;
    readonly hasReviewedSeasonalFact: boolean;
  }>;
}

/** Elapsed-day totals; whole days are the only complete non-overlapping series a provider reports. */
const DAILY_ACCUMULATION_INTERVAL_SECONDS = 24 * 60 * 60;
const RAINFALL_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which preconditions each rule key depends on.
 *
 * Keyed by rule key rather than derived from the definition, because a
 * rule's inputs are a property of its evaluator, and the evaluator is a
 * function this module cannot introspect. Keeping the map here — beside the
 * catalog it describes, with a test that every catalogued key appears —
 * makes an omission a visible gap rather than a silently empty blocker
 * list.
 */
const RULE_PRECONDITIONS: Readonly<Record<string, readonly CareRuleBlocker[]>> = {
  'watering.dry-spell-check': ['noWeatherObservation', 'noRainfallHistory'],
  'weather.frost-watch': ['noWeatherForecast'],
  'observation.routine-check-reminder': [],
  'lifecycle.harvest-readiness-check': [],
  'seasonal.sowing-window-check': ['noIdentifiedPlants', 'noReviewedSeasonalFacts'],
  'succession.replanting-reminder': ['noIdentifiedPlants', 'noReviewedSeasonalFacts'],
  'rotation.crop-rotation-caution': [
    'noIdentifiedPlants',
    'noPlacedPlants',
    'noReviewedSeasonalFacts',
  ],
};

/** Every precondition this readiness snapshot fails. */
function unmet(blocker: CareRuleBlocker, readiness: GardenReadiness): boolean {
  switch (blocker) {
    case 'noWeatherObservation':
      return !readiness.hasObservation;
    case 'noWeatherForecast':
      return !readiness.hasForecast;
    case 'noRainfallHistory':
      return !readiness.hasRainfallHistory;
    case 'noIdentifiedPlants':
      return !readiness.hasIdentifiedPlant;
    case 'noReviewedSeasonalFacts':
      return !readiness.hasReviewedSeasonalFact;
    case 'noPlacedPlants':
      return !readiness.hasPlacedPlant;
    default:
      return false;
  }
}

/**
 * Blockers ordered most-resolvable-first, so a client can lead with the one
 * worth acting on. A missing provider is a deployment fact nobody using the
 * app can change, so it comes first only because it makes every weather
 * blocker below it moot — reporting "set your location" to someone whose
 * environment can fetch nothing would be advice that cannot work.
 */
function blockersFor(rule: RuleDefinition, readiness: GardenReadiness): CareRuleBlocker[] {
  const blockers: CareRuleBlocker[] = [];
  const usesWeather = rule.weatherPolicy.use !== 'notUsed';

  if (usesWeather && !readiness.providerConfigured) {
    blockers.push('noWeatherProvider');
  } else if (!readiness.georeferenced && needsGeoreference(rule)) {
    // One absence, reported once: coordinates are both the weather request
    // and the hemisphere, so naming the downstream symptoms as well would
    // list three problems where there is one.
    blockers.push('gardenNotGeoreferenced');
  } else {
    for (const precondition of RULE_PRECONDITIONS[rule.ruleKey] ?? []) {
      if (unmet(precondition, readiness)) {
        blockers.push(precondition);
      }
    }
  }

  if (rule.review.reviewStatus === 'awaiting_horticultural_review') {
    blockers.push('awaitingHorticulturalReview');
  }
  return blockers;
}

/** Weather rules need coordinates to fetch at all; seasonal rules need them for the hemisphere. */
function needsGeoreference(rule: RuleDefinition): boolean {
  return (
    rule.weatherPolicy.use !== 'notUsed' ||
    (RULE_PRECONDITIONS[rule.ruleKey] ?? []).includes('noReviewedSeasonalFacts')
  );
}

export class GetGardenCareRules {
  constructor(
    private readonly catalog: RuleCatalog,
    private readonly authorization: GardenAuthorization,
    private readonly georeferences: GeoreferenceReader,
    private readonly getGardenWeather: GetGardenWeather,
    private readonly getGardenPrecipitation: GetGardenPrecipitation,
    private readonly plants: CareRulePlantReadinessSource,
    /** `null` when this environment names no active weather provider. */
    private readonly activeProviderKey: string | null,
    private readonly clock: { now(): Date },
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<GardenCareRulesResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const georeference = await this.georeferences.findCurrentForGarden(gardenId);
    const hemisphere =
      georeference === null
        ? null
        : georeference.geographicAnchor[1] >= 0
          ? 'northern'
          : 'southern';

    const [observation, forecast, rainfall, plantReadiness] = await Promise.all([
      this.getGardenWeather.execute({ gardenId, kind: 'observation' }),
      this.getGardenWeather.execute({ gardenId, kind: 'forecast' }),
      this.getGardenPrecipitation.execute({
        gardenId,
        since: new Date(this.clock.now().getTime() - RAINFALL_WINDOW_DAYS * DAY_MS),
        intervalSeconds: DAILY_ACCUMULATION_INTERVAL_SECONDS,
      }),
      this.plants.readGardenPlantReadiness(gardenId, hemisphere),
    ]);

    const readiness: GardenReadiness = {
      providerConfigured: this.activeProviderKey !== null,
      georeferenced: georeference !== null,
      hasObservation: observation.outcome === 'available',
      hasForecast: forecast.outcome === 'available',
      hasRainfallHistory: rainfall.length > 0,
      ...plantReadiness,
    };

    return {
      gardenId,
      rules: this.catalog.activeRules().map((rule) => ({
        ruleKey: rule.ruleKey,
        version: rule.version,
        careCategory: rule.careCategory,
        safetyTier: rule.safetyTier,
        urgency: rule.urgency,
        actionTitle: rule.actionTitle,
        description: rule.description,
        reviewStatus: rule.review.reviewStatus,
        usesWeather: rule.weatherPolicy.use !== 'notUsed',
        blockers: blockersFor(rule, readiness),
      })),
    };
  }
}
