import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  CoordinateSpace,
  CoordinateSpaceRepository,
} from '../application/coordinate-space-repository.js';

/** Every coordinate space this schema can describe today — see the migration's fixed `CHECK` constraints on `kind`/`axis_convention`. */
const ORIGIN_DESCRIPTION = 'Garden origin, established automatically on first map interaction.';

interface CoordinateSpaceRow {
  id: string;
  garden_id: string;
  kind: string;
  axis_convention: string;
  origin_description: string;
  created_at: Date;
}

function toCoordinateSpace(row: CoordinateSpaceRow): CoordinateSpace {
  return {
    id: row.id,
    gardenId: row.garden_id,
    kind: row.kind as CoordinateSpace['kind'],
    axisConvention: row.axis_convention as CoordinateSpace['axisConvention'],
    originDescription: row.origin_description,
    createdAt: row.created_at,
  };
}

export class KyselyCoordinateSpaceRepository implements CoordinateSpaceRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findByGardenId(gardenId: Uuid): Promise<CoordinateSpace | null> {
    const row = await this.db
      .selectFrom('gardens_mapping.coordinate_space')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .executeTakeFirst();

    return row === undefined ? null : toCoordinateSpace(row);
  }

  /**
   * Judgment call: garden creation (`CreateGarden`, Phase 2) does not create
   * a coordinate space — nothing in that command package's scope needed one.
   * Rather than require every map endpoint to special-case "this garden has
   * no coordinate space yet" as a distinct error state, both `GetGardenMap`
   * and `CreateMapObject` call this method, which creates the garden's one
   * coordinate space on whichever map interaction happens first and returns
   * the same row on every call after that — race-safe via the table's own
   * unique index on `garden_id` (`ON CONFLICT DO NOTHING`, then re-select).
   */
  async findOrCreateForGarden(gardenId: Uuid, now: Date): Promise<CoordinateSpace> {
    const existing = await this.findByGardenId(gardenId);
    if (existing !== null) {
      return existing;
    }

    const inserted = await this.db
      .insertInto('gardens_mapping.coordinate_space')
      .values({
        id: generateUuidV7(),
        garden_id: gardenId,
        origin_description: ORIGIN_DESCRIPTION,
        created_at: now,
      })
      .onConflict((oc) => oc.column('garden_id').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted !== undefined) {
      return toCoordinateSpace(inserted);
    }

    // Lost the creation race to a concurrent caller; its row is authoritative.
    const raced = await this.findByGardenId(gardenId);
    if (raced === null) {
      throw new Error(
        `Coordinate space for garden ${gardenId} was neither inserted nor found after a conflict.`,
      );
    }
    return raced;
  }
}
