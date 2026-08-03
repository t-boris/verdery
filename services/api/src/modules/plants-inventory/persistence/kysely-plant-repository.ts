import { SharedErrorCode } from '@verdery/api-contracts';
import type { Kysely, RawBuilder, SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonSeasonalActivity } from '../application/plant-search-filter-values.js';
import type {
  PlantRepository,
  PlantSearchFilters,
  PlantSearchPage,
} from '../application/plant-repository.js';
import type { AcquisitionDateType, GroupingKind, Plant } from '../domain/plant.js';
import type { LifecycleStage, PlantStatus } from '../domain/plant-lifecycle.js';
import { translateCheckViolation } from './translate-check-violation.js';

/**
 * `pg_trgm` similarity threshold for a real (non-null) `filters.query`.
 *
 * Shares the same value and the same empirical justification as
 * `kysely-taxonomy-reference-repository.ts`'s own `SIMILARITY_THRESHOLD` —
 * see that file's comment. `displayName` search only ever compares against
 * one field, so no `GREATEST` is needed here.
 */
const SIMILARITY_THRESHOLD = 0.25;

interface PlantRankedCursor {
  readonly rank: number;
  readonly id: string;
}

interface PlantChronologicalCursor {
  readonly createdAt: string;
  readonly id: string;
}

function invalidCursor(): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, 'The cursor is invalid.', {
    details: [{ code: 'request.cursor.invalid', pointer: '/cursor' }],
  });
}

function encodeRankedCursor(rank: number, id: string): string {
  return Buffer.from(JSON.stringify({ rank, id })).toString('base64url');
}

/** Malformed input here means either a bug in this service's own encoding or a client that tried to construct one — both are the client's problem to fix, matching `KyselyGardenRepository.decodeCursor`'s identical note. */
function decodeRankedCursor(cursor: string): PlantRankedCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['rank'] === 'number' &&
      typeof (parsed as Record<string, unknown>)['id'] === 'string'
    ) {
      return parsed as PlantRankedCursor;
    }
  } catch {
    // Falls through to the thrown ValidationError below.
  }

  throw invalidCursor();
}

function encodeChronologicalCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64url',
  );
}

function decodeChronologicalCursor(cursor: string): PlantChronologicalCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['createdAt'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['id'] === 'string'
    ) {
      return parsed as PlantChronologicalCursor;
    }
  } catch {
    // Falls through to the thrown ValidationError below.
  }

  throw invalidCursor();
}

interface PlantRowLike {
  id: string;
  garden_id: string;
  garden_area_map_object_id: string | null;
  placement_map_object_id: string | null;
  display_name: string;
  taxonomy_reference_id: string | null;
  variety_label: string | null;
  accepted_identification_id: string | null;
  acquisition_date: string | null;
  acquisition_date_type: string | null;
  grouping_kind: string;
  quantity: number | null;
  lifecycle_stage: string;
  status: string;
  condition_note: string | null;
  care_guidance_note: string | null;
  revision: number;
  created_by_profile_id: string;
  created_at: Date;
  updated_at: Date;
}

function toPlant(row: PlantRowLike): Plant {
  return {
    id: row.id,
    gardenId: row.garden_id,
    gardenAreaMapObjectId: row.garden_area_map_object_id,
    placementMapObjectId: row.placement_map_object_id,
    displayName: row.display_name,
    taxonomyReferenceId: row.taxonomy_reference_id,
    varietyLabel: row.variety_label,
    acceptedIdentificationId: row.accepted_identification_id,
    acquisitionDate: row.acquisition_date,
    acquisitionDateType: row.acquisition_date_type as AcquisitionDateType | null,
    groupingKind: row.grouping_kind as GroupingKind,
    quantity: row.quantity,
    lifecycleStage: row.lifecycle_stage as LifecycleStage,
    status: row.status as PlantStatus,
    conditionNote: row.condition_note,
    careGuidanceNote: row.care_guidance_note,
    revision: row.revision,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The month-range column pair each seasonal activity is stored in. */
const SEASONAL_WINDOW_COLUMNS = {
  sow_indoors: ['sow_indoors_start_month', 'sow_indoors_end_month'],
  sow_outdoors: ['sow_outdoors_start_month', 'sow_outdoors_end_month'],
  transplant: ['transplant_start_month', 'transplant_end_month'],
  harvest: ['harvest_start_month', 'harvest_end_month'],
} as const satisfies Record<TaxonSeasonalActivity, readonly [string, string]>;

/**
 * "Any of these activity windows is recorded", or with a month, "…and covers
 * that month".
 *
 * WINDOWS WRAP THE YEAR. A window stored as start 11, end 2 runs November to
 * February, so the naive `month BETWEEN start AND end` reports it as empty for
 * every month. Where start is greater than end the test inverts to `month >=
 * start OR month <= end`, which is the only reading under which a
 * winter-spanning window means anything at all.
 */
function seasonalWindowPredicate(
  activities: readonly TaxonSeasonalActivity[],
  month: number | null,
): RawBuilder<boolean> {
  const perActivity = activities.map((activity) => {
    const [startColumn, endColumn] = SEASONAL_WINDOW_COLUMNS[activity];
    const start = sql.ref(`season.${startColumn}`);
    const end = sql.ref(`season.${endColumn}`);
    if (month === null) {
      return sql<boolean>`${start} is not null`;
    }
    return sql<boolean>`(
      ${start} is not null
      and ${end} is not null
      and (
        (${start} <= ${end} and ${month} between ${start} and ${end})
        or (${start} > ${end} and (${month} >= ${start} or ${month} <= ${end}))
      )
    )`;
  });

  return perActivity.reduce((left, right) => sql<boolean>`(${left} or ${right})`);
}

export class KyselyPlantRepository implements PlantRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(plantId: Uuid): Promise<Plant | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant')
      .selectAll()
      .where('id', '=', plantId)
      .executeTakeFirst();

    return row === undefined ? null : toPlant(row);
  }

  async insert(plant: Plant): Promise<void> {
    try {
      await this.db
        .insertInto('plants_inventory.plant')
        .values({
          id: plant.id,
          garden_id: plant.gardenId,
          garden_area_map_object_id: plant.gardenAreaMapObjectId,
          placement_map_object_id: plant.placementMapObjectId,
          display_name: plant.displayName,
          taxonomy_reference_id: plant.taxonomyReferenceId,
          variety_label: plant.varietyLabel,
          accepted_identification_id: plant.acceptedIdentificationId,
          acquisition_date: plant.acquisitionDate,
          acquisition_date_type: plant.acquisitionDateType,
          grouping_kind: plant.groupingKind,
          quantity: plant.quantity,
          lifecycle_stage: plant.lifecycleStage,
          status: plant.status,
          condition_note: plant.conditionNote,
          care_guidance_note: plant.careGuidanceNote,
          revision: plant.revision,
          created_by_profile_id: plant.createdByProfileId,
          created_at: plant.createdAt,
          updated_at: plant.updatedAt,
        })
        .execute();
    } catch (error) {
      const translated = translateCheckViolation(error, '/displayName');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  async update(plant: Plant, expectedRevision: number): Promise<boolean> {
    try {
      const result = await this.db
        .updateTable('plants_inventory.plant')
        .set({
          garden_area_map_object_id: plant.gardenAreaMapObjectId,
          placement_map_object_id: plant.placementMapObjectId,
          display_name: plant.displayName,
          taxonomy_reference_id: plant.taxonomyReferenceId,
          variety_label: plant.varietyLabel,
          accepted_identification_id: plant.acceptedIdentificationId,
          acquisition_date: plant.acquisitionDate,
          acquisition_date_type: plant.acquisitionDateType,
          quantity: plant.quantity,
          lifecycle_stage: plant.lifecycleStage,
          status: plant.status,
          condition_note: plant.conditionNote,
          care_guidance_note: plant.careGuidanceNote,
          revision: plant.revision,
          updated_at: plant.updatedAt,
        })
        .where('id', '=', plant.id)
        .where('revision', '=', expectedRevision)
        .executeTakeFirst();

      return (result?.numUpdatedRows ?? 0n) === 1n;
    } catch (error) {
      const translated = translateCheckViolation(error, '/displayName');
      if (translated !== null) {
        throw translated;
      }
      throw error;
    }
  }

  async search(
    gardenId: Uuid,
    filters: PlantSearchFilters,
    cursor: string | null,
    limit: number,
  ): Promise<PlantSearchPage> {
    return filters.query === null
      ? this.searchChronological(gardenId, filters, cursor, limit)
      : this.searchByRelevance(gardenId, filters, filters.query, cursor, limit);
  }

  /** Applies the three structured filters shared by both search modes below, mutating neither the passed-in builder nor `filters`. */
  private applyStructuredFilters<O>(
    query: SelectQueryBuilder<DatabaseSchema, 'plants_inventory.plant', O>,
    filters: PlantSearchFilters,
  ): SelectQueryBuilder<DatabaseSchema, 'plants_inventory.plant', O> {
    let q = query;
    if (filters.lifecycleStage !== null) {
      q = q.where('lifecycle_stage', 'in', [...filters.lifecycleStage]);
    }
    if (filters.status !== null) {
      q = q.where('status', 'in', [...filters.status]);
    }
    if (filters.groupingKind !== null) {
      q = q.where('grouping_kind', 'in', [...filters.groupingKind]);
    }
    if (filters.identified !== null) {
      q = q.where('taxonomy_reference_id', filters.identified ? 'is not' : 'is', null);
    }

    // P11-SEARCH-01's six joined filters. Every one is `EXISTS` rather than a
    // join, deliberately: a plant with three observations carrying health
    // suggestions must appear ONCE, and a join would multiply it by the number
    // of matching rows and then need a `DISTINCT` that defeats the keyset
    // pagination this method depends on.
    if (filters.observedWithinDays !== null) {
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('observations_history.observation as recent')
            .select('recent.id')
            .whereRef('recent.plant_id', '=', 'plants_inventory.plant.id')
            .where(
              'recent.observed_at',
              '>=',
              sql<Date>`now() - make_interval(days => ${filters.observedWithinDays})`,
            ),
        ),
      );
    }

    // NOT the complement of the filter above: a plant with no observation at
    // all matches here, because "never recorded" is the strongest form of "not
    // recorded lately" and is exactly what a neglect filter is asked for.
    if (filters.notObservedForDays !== null) {
      q = q.where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('observations_history.observation as fresh')
              .select('fresh.id')
              .whereRef('fresh.plant_id', '=', 'plants_inventory.plant.id')
              .where(
                'fresh.observed_at',
                '>=',
                sql<Date>`now() - make_interval(days => ${filters.notObservedForDays})`,
              ),
          ),
        ),
      );
    }

    if (filters.healthConcern !== null && filters.healthConcern.length > 0) {
      const kinds = [...filters.healthConcern];
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('observations_history.observation as concern')
            .innerJoin(
              'observations_history.observation_photo as concern_photo',
              'concern_photo.observation_id',
              'concern.id',
            )
            .innerJoin(
              'observations_history.image_analysis_result as concern_result',
              'concern_result.observation_photo_id',
              'concern_photo.id',
            )
            .select('concern.id')
            .whereRef('concern.plant_id', '=', 'plants_inventory.plant.id')
            .where('concern_result.analysis_kind', 'in', kinds),
        ),
      );
    }

    if (filters.seasonalActivity !== null && filters.seasonalActivity.length > 0) {
      const activities = [...filters.seasonalActivity];
      const month = filters.seasonalMonth;
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('plants_inventory.taxonomy_seasonal_fact as season')
            .select('season.id')
            .whereRef(
              'season.taxonomy_reference_id',
              '=',
              'plants_inventory.plant.taxonomy_reference_id',
            )
            .where(seasonalWindowPredicate(activities, month)),
        ),
      );
    }

    if (filters.distributionStatus !== null && filters.distributionStatus.length > 0) {
      const statuses = [...filters.distributionStatus];
      const region = filters.distributionRegion;
      q = q.where((eb) => {
        let inner = eb
          .selectFrom('integrations.plant_taxonomy_mapping as mapping')
          .innerJoin('integrations.plant_distribution_assertion as distribution', (join) =>
            join
              .onRef('distribution.provider_key', '=', 'mapping.provider_key')
              .onRef('distribution.provider_taxon_id', '=', 'mapping.provider_taxon_id'),
          )
          .select('mapping.id')
          .whereRef(
            'mapping.taxonomy_reference_id',
            '=',
            'plants_inventory.plant.taxonomy_reference_id',
          )
          .where('distribution.status', 'in', statuses);
        if (region !== null) {
          inner = inner.where('distribution.region', '=', region);
        }
        return eb.exists(inner);
      });
    }

    if (filters.profileCompleteness !== null) {
      const completeness = filters.profileCompleteness;
      q = q.where((eb) => {
        const profiles = eb
          .selectFrom('plants_inventory.plant_profile_version as profile')
          .select('profile.id')
          .whereRef(
            'profile.taxonomy_reference_id',
            '=',
            'plants_inventory.plant.taxonomy_reference_id',
          );
        if (completeness === 'none') {
          return eb.not(eb.exists(profiles));
        }
        return eb.exists(profiles.where('profile.is_partial', '=', completeness === 'partial'));
      });
    }

    return q;
  }

  /**
   * `filters.query` given: trigram-ranked, most-similar-first. `rank_score`
   * is selected (not just used in `WHERE`/`ORDER BY`) purely so the last
   * page row's own score can be read back to build the next keyset cursor —
   * Postgres does not allow a `WHERE` clause to reference a `SELECT`-list
   * alias, so the `similarity(...)` expression is still repeated in the
   * keyset predicate below rather than reused by name.
   */
  private async searchByRelevance(
    gardenId: Uuid,
    filters: PlantSearchFilters,
    queryText: string,
    cursor: string | null,
    limit: number,
  ): Promise<PlantSearchPage> {
    let query = this.applyStructuredFilters(
      this.db
        .selectFrom('plants_inventory.plant')
        .selectAll()
        .select(sql<number>`similarity(display_name, ${queryText})`.as('rank_score'))
        .where('garden_id', '=', gardenId)
        .where(sql<boolean>`similarity(display_name, ${queryText}) > ${SIMILARITY_THRESHOLD}`),
      filters,
    );

    if (cursor !== null) {
      const decoded = decodeRankedCursor(cursor);
      query = query.where(
        sql<boolean>`(similarity(display_name, ${queryText}) < ${decoded.rank}
          OR (similarity(display_name, ${queryText}) = ${decoded.rank} AND id < ${decoded.id}))`,
      );
    }

    const rows = await query
      .orderBy(sql`similarity(display_name, ${queryText})`, 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(toPlant);

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last !== undefined ? encodeRankedCursor(last.rank_score, last.id) : null;

    return { items, nextCursor };
  }

  /** `filters.query` is `null`: plain listing, most-recently-created-first — the same ordering and keyset-cursor shape `KyselyGardenRepository.listForProfile` already uses. */
  private async searchChronological(
    gardenId: Uuid,
    filters: PlantSearchFilters,
    cursor: string | null,
    limit: number,
  ): Promise<PlantSearchPage> {
    let query = this.applyStructuredFilters(
      this.db.selectFrom('plants_inventory.plant').selectAll().where('garden_id', '=', gardenId),
      filters,
    );

    if (cursor !== null) {
      const decoded = decodeChronologicalCursor(cursor);
      const cursorCreatedAt = new Date(decoded.createdAt);
      query = query.where((eb) =>
        eb.or([
          eb('created_at', '<', cursorCreatedAt),
          eb.and([eb('created_at', '=', cursorCreatedAt), eb('id', '<', decoded.id)]),
        ]),
      );
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(toPlant);

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last !== undefined ? encodeChronologicalCursor(last.created_at, last.id) : null;

    return { items, nextCursor };
  }
}
