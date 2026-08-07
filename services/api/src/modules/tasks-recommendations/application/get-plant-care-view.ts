/**
 * Everything the engine currently has to say about ONE plant: what it is
 * being asked for, what work is already open on it, and how much rain has
 * actually reached it.
 *
 * WHY THIS EXISTS. Opening a plant showed its identity, journal and
 * observations and nothing about its care. The recommendations existed —
 * the engine has always targeted individual plants — but they were only
 * ever reachable from the garden-wide Today list, so the obvious question
 * ("what does THIS plant need?") had no answer on the page that asks it.
 *
 * THIS READS; IT DOES NOT RE-DECIDE. Every recommendation and task here was
 * produced by the scheduled evaluation and is quoted as stored, with the
 * rule identity and evidence the engine recorded. Nothing is recomputed for
 * display: a view that re-derived "would this rule fire" would be a second
 * implementation of the engine's judgment and would disagree with it within
 * one change.
 *
 * THE WATER BALANCE IS REPORTED, NEVER PRESCRIBED. It quotes the same
 * window, reference supply and threshold `watering.dry-spell-check@2`
 * decides on — imported from the rule, not copied — so the number on the
 * page is the number the rule read. It reports a shortfall in millimetres
 * and stops there: no watering amount, no schedule, and no claim about the
 * soil, exactly as the rule's own description promises.
 *
 * UNKNOWN IS NOT ZERO. With no elapsed daily totals stored, `accumulated`
 * is `null` and `known` is `false` — never `0`, which would read as "no rain
 * fell". The rule refuses to guess on this input and so does the view.
 *
 * Source: domain/rules/watering-dry-spell-check-v2.ts;
 *         application/get-today-view.ts (the garden-wide sibling).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GetGardenPrecipitation } from '../../integrations/public.js';
import type { PlantRepository } from '../../plants-inventory/public.js';
import { summarizePrecipitationSince } from '../domain/garden-facts.js';
import {
  DRY_THRESHOLD_MM,
  WATERING_DRY_SPELL_PARAMETERS,
} from '../domain/rules/watering-dry-spell-check-v2.js';
import type { RecommendationCandidateRepository } from './recommendation-candidate-repository.js';
import type { TaskRepository } from './task-repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The rainfall the watering check reads, as a balance a person can act on.
 *
 * `known: false` means no daily totals are stored for the window, so every
 * millimetre figure is `null`. It does NOT mean the window was dry.
 */
export interface PlantWaterBalance {
  readonly known: boolean;
  readonly windowDays: number;
  /** Days within the window that actually carry a stored total — a partial window is reported, not extrapolated. */
  readonly daysCovered: number;
  readonly accumulatedMm: number | null;
  /** What the window normally supplies, the rule's own reference figure. */
  readonly referenceMm: number;
  /** Below this, the rule considers the window short. */
  readonly thresholdMm: number;
  /** How far below the threshold the window is, or `0` when it is not short. `null` when unknown. */
  readonly shortfallMm: number | null;
  readonly lastWetDayAt: string | null;
}

export interface PlantCareRecommendation {
  readonly id: Uuid;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly careCategory: string;
  readonly urgency: string;
  readonly safetyTier: string;
  /** The engine's own deterministic explanation, quoted as stored. `null` predates the explanation column. */
  readonly explanation: string | null;
  readonly state: string;
  readonly windowEnd: string | null;
  readonly createdAt: string;
}

export interface PlantCareTask {
  readonly id: Uuid;
  readonly title: string;
  readonly status: string;
  readonly dueDate: string | null;
  readonly originRecommendationId: Uuid | null;
}

export interface PlantCareView {
  readonly plantId: Uuid;
  readonly gardenId: Uuid;
  readonly recommendations: readonly PlantCareRecommendation[];
  readonly tasks: readonly PlantCareTask[];
  readonly water: PlantWaterBalance;
}

export class GetPlantCareView {
  constructor(
    private readonly plants: PlantRepository,
    private readonly candidates: RecommendationCandidateRepository,
    private readonly tasks: TaskRepository,
    private readonly precipitation: GetGardenPrecipitation,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(gardenId: Uuid, plantId: Uuid, profileId: Uuid): Promise<PlantCareView | null> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const plant = await this.plants.findById(plantId);
    // The garden check is not redundant with the capability check above: it
    // stops a member of garden A reading a plant of garden B by id.
    if (plant === null || plant.gardenId !== gardenId) {
      return null;
    }

    const now = this.clock.now();
    const since = new Date(now.getTime() - WATERING_DRY_SPELL_PARAMETERS.dryWindowDays * DAY_MS);

    const [live, allTasks, entries] = await Promise.all([
      this.candidates.listLiveForGarden(gardenId),
      this.tasks.listForGarden(gardenId, null),
      this.precipitation.execute({ gardenId, intervalSeconds: 86_400, since }),
    ]);

    return {
      plantId,
      gardenId,
      recommendations: live
        .filter((stored) => stored.candidate.targetPlantId === plantId)
        .map((stored) => ({
          id: stored.candidate.id,
          ruleKey: stored.ruleKey,
          ruleVersion: stored.ruleVersion,
          careCategory: stored.candidate.careCategory,
          urgency: stored.candidate.urgency,
          safetyTier: stored.candidate.safetyTier,
          explanation: stored.candidate.explanation,
          state: stored.candidate.state,
          windowEnd: stored.candidate.windowEnd?.toISOString() ?? null,
          createdAt: stored.candidate.createdAt.toISOString(),
        })),
      tasks: allTasks
        .filter((task) => task.targetPlantId === plantId)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          originRecommendationId: task.originRecommendationId,
        })),
      water: summarizeWater(entries, since),
    };
  }
}

function summarizeWater(
  entries: readonly { readonly effectiveAt: Date; readonly precipitationMm: number }[],
  since: Date,
): PlantWaterBalance {
  const shared = {
    windowDays: WATERING_DRY_SPELL_PARAMETERS.dryWindowDays,
    referenceMm: WATERING_DRY_SPELL_PARAMETERS.referenceWeeklySupplyMm,
    thresholdMm: DRY_THRESHOLD_MM,
  };

  if (entries.length === 0) {
    return {
      ...shared,
      known: false,
      daysCovered: 0,
      accumulatedMm: null,
      shortfallMm: null,
      lastWetDayAt: null,
    };
  }

  // The SAME summary the rule runs, over the same window — not a parallel
  // sum that could round or filter differently.
  const summary = summarizePrecipitationSince(
    {
      windowDays: WATERING_DRY_SPELL_PARAMETERS.dryWindowDays,
      dailyTotals: entries.map((entry) => ({
        effectiveAt: entry.effectiveAt,
        precipitationMm: entry.precipitationMm,
      })),
    },
    since,
    WATERING_DRY_SPELL_PARAMETERS.meaningfulRainMm,
  );

  return {
    ...shared,
    known: true,
    daysCovered: summary.daysCovered,
    accumulatedMm: summary.totalMm,
    shortfallMm: Math.max(0, DRY_THRESHOLD_MM - summary.totalMm),
    lastWetDayAt: summary.lastWetDayAt?.toISOString() ?? null,
  };
}
