import { SharedErrorCode } from '@verdery/api-contracts';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  CandidateListFilters,
  CandidateListPage,
  PlantCandidateRepository,
} from '../application/plant-candidate-repository.js';
import type { GroupingKind } from '../domain/plant.js';
import type {
  CandidatePriority,
  CandidateStatus,
  PlantCandidate,
} from '../domain/plant-candidate.js';
import { translateCheckViolation } from './translate-check-violation.js';

interface CandidateChronologicalCursor {
  readonly createdAt: string;
  readonly id: string;
}

function invalidCursor(): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, 'The cursor is invalid.', {
    details: [{ code: 'request.cursor.invalid', pointer: '/cursor' }],
  });
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): CandidateChronologicalCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['createdAt'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['id'] === 'string'
    ) {
      return parsed as CandidateChronologicalCursor;
    }
  } catch {
    // Falls through to the thrown ValidationError below.
  }
  throw invalidCursor();
}

interface PlantCandidateRowLike {
  id: string;
  garden_id: string;
  proposed_garden_area_map_object_id: string | null;
  proposed_placement_map_object_id: string | null;
  display_name: string;
  taxonomy_reference_id: string | null;
  variety_label: string | null;
  grouping_kind: string;
  quantity: number | null;
  status: string;
  rationale_note: string | null;
  priority: string | null;
  price_amount: string | null;
  price_currency: string | null;
  purchase_source: string | null;
  alternative_to_candidate_id: string | null;
  revision: number;
  created_by_profile_id: string;
  created_at: Date;
  updated_at: Date;
}

function toCandidate(row: PlantCandidateRowLike): PlantCandidate {
  return {
    id: row.id,
    gardenId: row.garden_id,
    proposedGardenAreaMapObjectId: row.proposed_garden_area_map_object_id,
    proposedPlacementMapObjectId: row.proposed_placement_map_object_id,
    displayName: row.display_name,
    taxonomyReferenceId: row.taxonomy_reference_id,
    varietyLabel: row.variety_label,
    groupingKind: row.grouping_kind as GroupingKind,
    quantity: row.quantity,
    status: row.status as CandidateStatus,
    rationaleNote: row.rationale_note,
    priority: row.priority as CandidatePriority | null,
    priceAmount: row.price_amount === null ? null : Number(row.price_amount),
    priceCurrency: row.price_currency,
    purchaseSource: row.purchase_source,
    alternativeToCandidateId: row.alternative_to_candidate_id,
    revision: row.revision,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyPlantCandidateRepository implements PlantCandidateRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(candidateId: Uuid): Promise<PlantCandidate | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant_candidate')
      .selectAll()
      .where('id', '=', candidateId)
      .executeTakeFirst();

    return row === undefined ? null : toCandidate(row);
  }

  async insert(candidate: PlantCandidate): Promise<void> {
    try {
      await this.db
        .insertInto('plants_inventory.plant_candidate')
        .values({
          id: candidate.id,
          garden_id: candidate.gardenId,
          proposed_garden_area_map_object_id: candidate.proposedGardenAreaMapObjectId,
          proposed_placement_map_object_id: candidate.proposedPlacementMapObjectId,
          display_name: candidate.displayName,
          taxonomy_reference_id: candidate.taxonomyReferenceId,
          variety_label: candidate.varietyLabel,
          grouping_kind: candidate.groupingKind,
          quantity: candidate.quantity,
          status: candidate.status,
          rationale_note: candidate.rationaleNote,
          priority: candidate.priority,
          price_amount: candidate.priceAmount,
          price_currency: candidate.priceCurrency,
          purchase_source: candidate.purchaseSource,
          alternative_to_candidate_id: candidate.alternativeToCandidateId,
          revision: candidate.revision,
          created_by_profile_id: candidate.createdByProfileId,
          created_at: candidate.createdAt,
          updated_at: candidate.updatedAt,
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

  async update(candidate: PlantCandidate, expectedRevision: number): Promise<boolean> {
    try {
      const result = await this.db
        .updateTable('plants_inventory.plant_candidate')
        .set({
          proposed_garden_area_map_object_id: candidate.proposedGardenAreaMapObjectId,
          proposed_placement_map_object_id: candidate.proposedPlacementMapObjectId,
          display_name: candidate.displayName,
          taxonomy_reference_id: candidate.taxonomyReferenceId,
          variety_label: candidate.varietyLabel,
          quantity: candidate.quantity,
          status: candidate.status,
          rationale_note: candidate.rationaleNote,
          priority: candidate.priority,
          price_amount: candidate.priceAmount,
          price_currency: candidate.priceCurrency,
          purchase_source: candidate.purchaseSource,
          revision: candidate.revision,
          updated_at: candidate.updatedAt,
        })
        .where('id', '=', candidate.id)
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

  async list(
    gardenId: Uuid,
    filters: CandidateListFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CandidateListPage> {
    let query = this.db
      .selectFrom('plants_inventory.plant_candidate')
      .selectAll()
      .where('garden_id', '=', gardenId);

    if (filters.status !== null) {
      query = query.where('status', 'in', filters.status);
    }

    if (cursor !== null) {
      const decoded = decodeCursor(cursor);
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
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toCandidate),
      nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
    };
  }
}
