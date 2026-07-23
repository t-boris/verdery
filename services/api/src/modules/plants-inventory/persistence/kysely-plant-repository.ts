import { SharedErrorCode } from '@verdery/api-contracts';
import type { Kysely, SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
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
