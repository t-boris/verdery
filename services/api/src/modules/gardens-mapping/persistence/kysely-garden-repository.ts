import { SharedErrorCode } from '@verdery/api-contracts';
import type { Kysely } from 'kysely';
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

interface GardenCursor {
  readonly createdAt: string;
  readonly id: string;
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

  throw new ValidationError(SharedErrorCode.RequestInvalid, 'The cursor is invalid.', {
    details: [{ code: 'request.cursor.invalid', pointer: '/cursor' }],
  });
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
}
