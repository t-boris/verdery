/**
 * Query-string parsing for `GET /gardens/{gardenId}/plants`.
 *
 * Split out of `plant-routes.ts` when P11-SEARCH-01's six joined filters took
 * that file past the 600-line limit. The seam is a real one: everything here
 * turns untyped query values into a validated `SearchPlantsFilters` and knows
 * nothing about routes, handlers, or authorization.
 *
 * The vocabularies below duplicate the OpenAPI enums and the database CHECK
 * constraints deliberately — this layer must reject an unknown value with a
 * pointer rather than pass it to SQL, and it cannot do that from a type alone.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `searchPlants`;
 * implementation-plan.md work package P11-SEARCH-01.
 */

import type { FastifyRequest } from 'fastify';
import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type {
  ImageAnalysisKind,
  PlantDistributionStatus,
  PlantProfileCompleteness,
  TaxonSeasonalActivity,
} from '../application/plant-search-filter-values.js';
import type { SearchPlantsFilters } from '../application/search-plants.js';
import { GROUPING_KINDS, LIFECYCLE_STAGES, PLANT_STATUSES } from './parse-plant-request.js';
import type { GroupingKind } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';

export const MAX_SEARCH_PLANTS_LIMIT = 100;
export const DEFAULT_SEARCH_PLANTS_LIMIT = 50;

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

const IMAGE_ANALYSIS_KINDS: readonly ImageAnalysisKind[] = ['stress', 'disease', 'pest', 'other'];
const TAXON_SEASONAL_ACTIVITIES: readonly TaxonSeasonalActivity[] = [
  'sow_indoors',
  'sow_outdoors',
  'transplant',
  'harvest',
];
const PLANT_DISTRIBUTION_STATUSES: readonly PlantDistributionStatus[] = [
  'native',
  'introduced',
  'invasive',
  'regulated',
];
const PLANT_PROFILE_COMPLETENESS_VALUES: readonly PlantProfileCompleteness[] = [
  'complete',
  'partial',
  'none',
];

/** Parses a comma-separated enum query parameter (OpenAPI `style: form, explode: false`), the same convention `task-routes.ts`'s own `parseStatusFilter` establishes for `TaskStatus`. */
function parseCommaSeparatedEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  pointer: string,
): readonly T[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw invalid(`${pointer} must be a comma-separated list.`, 'request.invalid', pointer);
  }

  return raw.split(',').map((candidate) => {
    if (!(allowed as readonly string[]).includes(candidate)) {
      throw invalid(
        `${pointer} must be one of: ${allowed.join(', ')}.`,
        'request.enum.invalid',
        pointer,
      );
    }
    return candidate as T;
  });
}

/** Mirrors `candidate-routes.ts`'s own `parseIdentifiedFilter` — kept local since it is this file's only caller. */
function parseIdentifiedFilter(raw: unknown): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw !== 'true' && raw !== 'false') {
    throw invalid('/identified must be "true" or "false".', 'request.invalid', '/identified');
  }
  return raw === 'true';
}

/** A day count for the journal-recency filters. Rejects zero and negatives rather than silently treating them as "no filter", which would hide a client bug. */
function parseDayCount(raw: unknown, pointer: string): number | undefined {
  return parseBoundedInteger(raw, 1, 3650, pointer);
}

function parseBoundedInteger(
  raw: unknown,
  minimum: number,
  maximum: number,
  pointer: string,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw invalid(
      `${pointer.slice(1)} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
      'request.query.invalid',
      pointer,
    );
  }
  return parsed;
}

export function parseSearchPlantsQuery(request: FastifyRequest): {
  filters: SearchPlantsFilters;
  cursor: string | null;
  limit: number;
} {
  const raw = request.query as {
    query?: unknown;
    lifecycleStage?: unknown;
    status?: unknown;
    groupingKind?: unknown;
    identified?: unknown;
    observedWithinDays?: unknown;
    notObservedForDays?: unknown;
    healthConcern?: unknown;
    seasonalActivity?: unknown;
    seasonalMonth?: unknown;
    distributionStatus?: unknown;
    distributionRegion?: unknown;
    profileCompleteness?: unknown;
    cursor?: unknown;
    limit?: unknown;
  };

  const query = typeof raw.query === 'string' && raw.query.length > 0 ? raw.query : null;
  const cursor = typeof raw.cursor === 'string' && raw.cursor.length > 0 ? raw.cursor : null;

  const lifecycleStage = parseCommaSeparatedEnum<LifecycleStage>(
    raw.lifecycleStage,
    LIFECYCLE_STAGES,
    '/lifecycleStage',
  );
  const status = parseCommaSeparatedEnum<PlantStatus>(raw.status, PLANT_STATUSES, '/status');
  const groupingKind = parseCommaSeparatedEnum<GroupingKind>(
    raw.groupingKind,
    GROUPING_KINDS,
    '/groupingKind',
  );
  const identified = parseIdentifiedFilter(raw.identified);
  const healthConcern = parseCommaSeparatedEnum<ImageAnalysisKind>(
    raw.healthConcern,
    IMAGE_ANALYSIS_KINDS,
    '/healthConcern',
  );
  const seasonalActivity = parseCommaSeparatedEnum<TaxonSeasonalActivity>(
    raw.seasonalActivity,
    TAXON_SEASONAL_ACTIVITIES,
    '/seasonalActivity',
  );
  const distributionStatus = parseCommaSeparatedEnum<PlantDistributionStatus>(
    raw.distributionStatus,
    PLANT_DISTRIBUTION_STATUSES,
    '/distributionStatus',
  );
  const profileCompleteness = parseCommaSeparatedEnum<PlantProfileCompleteness>(
    raw.profileCompleteness,
    PLANT_PROFILE_COMPLETENESS_VALUES,
    '/profileCompleteness',
  )?.[0];
  const observedWithinDays = parseDayCount(raw.observedWithinDays, '/observedWithinDays');
  const notObservedForDays = parseDayCount(raw.notObservedForDays, '/notObservedForDays');
  const seasonalMonth = parseBoundedInteger(raw.seasonalMonth, 1, 12, '/seasonalMonth');
  const distributionRegion =
    typeof raw.distributionRegion === 'string' && raw.distributionRegion.trim() !== ''
      ? raw.distributionRegion
      : undefined;

  let limit = DEFAULT_SEARCH_PLANTS_LIMIT;
  if (raw.limit !== undefined) {
    const parsedLimit = Number(raw.limit);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > MAX_SEARCH_PLANTS_LIMIT
    ) {
      throw invalid(
        `limit must be between 1 and ${String(MAX_SEARCH_PLANTS_LIMIT)}.`,
        'request.limit.invalid',
        '/limit',
      );
    }
    limit = parsedLimit;
  }

  return {
    filters: {
      query,
      ...(lifecycleStage === undefined ? {} : { lifecycleStage }),
      ...(status === undefined ? {} : { status }),
      ...(groupingKind === undefined ? {} : { groupingKind }),
      ...(identified === undefined ? {} : { identified }),
      ...(observedWithinDays === undefined ? {} : { observedWithinDays }),
      ...(notObservedForDays === undefined ? {} : { notObservedForDays }),
      ...(healthConcern === undefined ? {} : { healthConcern }),
      ...(seasonalActivity === undefined ? {} : { seasonalActivity }),
      ...(seasonalMonth === undefined ? {} : { seasonalMonth }),
      ...(distributionStatus === undefined ? {} : { distributionStatus }),
      ...(distributionRegion === undefined ? {} : { distributionRegion }),
      ...(profileCompleteness === undefined ? {} : { profileCompleteness }),
    },
    cursor,
    limit,
  };
}
