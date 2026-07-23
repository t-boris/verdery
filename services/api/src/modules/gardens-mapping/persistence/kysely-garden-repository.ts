import { SharedErrorCode } from '@verdery/api-contracts';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Garden, GardenLifecycleState } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';
import type {
  GardenListPage,
  GardenRepository,
  GardenWithCallerRole,
} from '../application/garden-repository.js';

/**
 * `pg_trgm` similarity threshold for a real (non-null) `nameQuery`.
 *
 * Shares the same value and the same empirical justification as
 * `kysely-taxonomy-reference-repository.ts`'s own `SIMILARITY_THRESHOLD` —
 * see that file's comment. `name` search only ever compares against one
 * field, so no `GREATEST` is needed here, matching `KyselyPlantRepository`'s
 * own `displayName` search for the identical reason.
 */
const SIMILARITY_THRESHOLD = 0.25;

interface GardenCursor {
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

/** Malformed input here means either a bug in this service's own encoding or a client that tried to construct one — both are the client's problem to fix, matching "clients must not parse it." */
function decodeCursor(cursor: string): GardenCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['createdAt'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['id'] === 'string'
    ) {
      return parsed as GardenCursor;
    }
  } catch {
    // Falls through to the thrown ValidationError below.
  }

  throw invalidCursor();
}

interface GardenRankedCursor {
  readonly rank: number;
  readonly id: string;
}

function encodeRankedCursor(rank: number, id: string): string {
  return Buffer.from(JSON.stringify({ rank, id })).toString('base64url');
}

function decodeRankedCursor(cursor: string): GardenRankedCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['rank'] === 'number' &&
      typeof (parsed as Record<string, unknown>)['id'] === 'string'
    ) {
      return parsed as GardenRankedCursor;
    }
  } catch {
    // Falls through to the thrown ValidationError below.
  }

  throw invalidCursor();
}

interface GardenRowLike {
  id: string;
  name: string;
  lifecycle_state: string;
  revision: number;
  created_by_profile_id: string;
  created_at: Date;
  updated_at: Date;
  deletion_requested_at: Date | null;
}

function toGarden(row: GardenRowLike): Garden {
  return {
    id: row.id,
    name: row.name,
    lifecycleState: row.lifecycle_state as GardenLifecycleState,
    revision: row.revision,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletionRequestedAt: row.deletion_requested_at,
  };
}

export class KyselyGardenRepository implements GardenRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(id: Uuid): Promise<Garden | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.garden')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toGarden(row);
  }

  async insert(garden: Garden): Promise<void> {
    await this.db
      .insertInto('gardens_mapping.garden')
      .values({
        id: garden.id,
        name: garden.name,
        lifecycle_state: garden.lifecycleState,
        revision: garden.revision,
        created_by_profile_id: garden.createdByProfileId,
        created_at: garden.createdAt,
        updated_at: garden.updatedAt,
        deletion_requested_at: garden.deletionRequestedAt,
      })
      .execute();
  }

  async update(garden: Garden, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .updateTable('gardens_mapping.garden')
      .set({
        name: garden.name,
        lifecycle_state: garden.lifecycleState,
        revision: garden.revision,
        updated_at: garden.updatedAt,
        deletion_requested_at: garden.deletionRequestedAt,
      })
      .where('id', '=', garden.id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) === 1n;
  }

  async listForProfile(
    profileId: Uuid,
    cursor: string | null,
    limit: number,
    nameQuery: string | null,
  ): Promise<GardenListPage> {
    return nameQuery === null
      ? this.listChronological(profileId, cursor, limit)
      : this.listByRelevance(profileId, nameQuery, cursor, limit);
  }

  /** `nameQuery` is `null`: unchanged from before P4-SEARCH-01 added the parameter — most recently created first. */
  private async listChronological(
    profileId: Uuid,
    cursor: string | null,
    limit: number,
  ): Promise<GardenListPage> {
    const decoded = cursor === null ? null : decodeCursor(cursor);

    let query = this.db
      .selectFrom('gardens_mapping.garden as g')
      .innerJoin('collaboration.membership as m', (join) =>
        join
          .onRef('m.garden_id', '=', 'g.id')
          .on('m.profile_id', '=', profileId)
          .on('m.state', '=', 'active'),
      )
      .select([
        'g.id',
        'g.name',
        'g.lifecycle_state',
        'g.revision',
        'g.created_by_profile_id',
        'g.created_at',
        'g.updated_at',
        'g.deletion_requested_at',
        'm.role as caller_role',
      ])
      .orderBy('g.created_at', 'desc')
      .orderBy('g.id', 'desc')
      .limit(limit + 1);

    if (decoded !== null) {
      const cursorCreatedAt = new Date(decoded.createdAt);
      query = query.where((eb) =>
        eb.or([
          eb('g.created_at', '<', cursorCreatedAt),
          eb.and([eb('g.created_at', '=', cursorCreatedAt), eb('g.id', '<', decoded.id)]),
        ]),
      );
    }

    const rows = await query.execute();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: GardenWithCallerRole[] = pageRows.map((row) => ({
      ...toGarden(row),
      callerRole: row.caller_role as GardenRole,
    }));

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null;

    return { items, nextCursor };
  }

  /** `nameQuery` is a real, non-blank query: trigram-ranked, most-similar first, still restricted to the profile's own active memberships. */
  private async listByRelevance(
    profileId: Uuid,
    nameQuery: string,
    cursor: string | null,
    limit: number,
  ): Promise<GardenListPage> {
    let query = this.db
      .selectFrom('gardens_mapping.garden as g')
      .innerJoin('collaboration.membership as m', (join) =>
        join
          .onRef('m.garden_id', '=', 'g.id')
          .on('m.profile_id', '=', profileId)
          .on('m.state', '=', 'active'),
      )
      .select([
        'g.id',
        'g.name',
        'g.lifecycle_state',
        'g.revision',
        'g.created_by_profile_id',
        'g.created_at',
        'g.updated_at',
        'g.deletion_requested_at',
        'm.role as caller_role',
      ])
      .select(sql<number>`similarity(g.name, ${nameQuery})`.as('rank_score'))
      .where(sql<boolean>`similarity(g.name, ${nameQuery}) > ${SIMILARITY_THRESHOLD}`);

    if (cursor !== null) {
      const decoded = decodeRankedCursor(cursor);
      query = query.where(
        sql<boolean>`(similarity(g.name, ${nameQuery}) < ${decoded.rank}
          OR (similarity(g.name, ${nameQuery}) = ${decoded.rank} AND g.id < ${decoded.id}))`,
      );
    }

    const rows = await query
      .orderBy(sql`similarity(g.name, ${nameQuery})`, 'desc')
      .orderBy('g.id', 'desc')
      .limit(limit + 1)
      .execute();

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: GardenWithCallerRole[] = pageRows.map((row) => ({
      ...toGarden(row),
      callerRole: row.caller_role as GardenRole,
    }));

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last !== undefined ? encodeRankedCursor(last.rank_score, last.id) : null;

    return { items, nextCursor };
  }
}
