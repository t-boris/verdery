import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenAssignmentDetail,
  GardenAssignmentInsertInput,
  GardenAssignmentRepository,
  GardenAssignmentRole,
} from '../application/garden-assignment-repository.js';
import type { GardenAssignmentState } from '../domain/garden-assignment-state.js';

interface GardenAssignmentRowShape {
  id: string;
  organization_id: string;
  profile_id: string;
  garden_id: string;
  role: string;
  state: string;
  valid_from: Date;
  valid_until: Date | null;
  created_by_profile_id: string;
  created_at: Date;
}

function toDetail(row: GardenAssignmentRowShape): GardenAssignmentDetail {
  return {
    id: row.id,
    organizationId: row.organization_id,
    profileId: row.profile_id,
    gardenId: row.garden_id,
    role: row.role as GardenAssignmentRole,
    state: row.state as GardenAssignmentState,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'organization_id',
  'profile_id',
  'garden_id',
  'role',
  'state',
  'valid_from',
  'valid_until',
  'created_by_profile_id',
  'created_at',
] as const;

export class KyselyGardenAssignmentRepository implements GardenAssignmentRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(input: GardenAssignmentInsertInput): Promise<void> {
    await this.db
      .insertInto('collaboration.garden_assignment')
      .values({
        id: input.id,
        organization_id: input.organizationId,
        profile_id: input.profileId,
        garden_id: input.gardenId,
        role: input.role,
        state: 'active',
        valid_from: input.now,
        valid_until: null,
        created_by_profile_id: input.createdByProfileId,
        created_at: input.now,
      })
      .execute();
  }

  async findActiveByGardenAndProfile(
    gardenId: Uuid,
    profileId: Uuid,
  ): Promise<GardenAssignmentDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.garden_assignment')
      .select(SELECTED_COLUMNS)
      .where('garden_id', '=', gardenId)
      .where('profile_id', '=', profileId)
      .where('state', '=', 'active')
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async findByIdAndOrganization(
    id: Uuid,
    organizationId: Uuid,
  ): Promise<GardenAssignmentDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.garden_assignment')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async lockById(id: Uuid): Promise<GardenAssignmentDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.garden_assignment')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async transitionState(id: Uuid, state: 'ended' | 'revoked', validUntil: Date): Promise<void> {
    await this.db
      .updateTable('collaboration.garden_assignment')
      .set({ state, valid_until: validUntil })
      .where('id', '=', id)
      .execute();
  }

  async listActiveForOrganization(organizationId: Uuid): Promise<GardenAssignmentDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.garden_assignment')
      .select(SELECTED_COLUMNS)
      .where('organization_id', '=', organizationId)
      .where('state', '=', 'active')
      .orderBy('valid_from', 'desc')
      .execute();

    return rows.map(toDetail);
  }

  async listActiveForGarden(gardenId: Uuid): Promise<GardenAssignmentDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.garden_assignment')
      .select(SELECTED_COLUMNS)
      .where('garden_id', '=', gardenId)
      .where('state', '=', 'active')
      .orderBy('valid_from', 'desc')
      .execute();

    return rows.map(toDetail);
  }
}
