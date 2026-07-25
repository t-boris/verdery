import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRole } from '../domain/garden-role.js';
import type {
  GardenMembershipState,
  GardenPartitionMembership,
  Membership,
  MembershipDetail,
  MembershipRepository,
} from '../application/membership-repository.js';

export class KyselyMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findActiveMembership(gardenId: Uuid, profileId: Uuid): Promise<Membership | null> {
    const row = await this.db
      .selectFrom('collaboration.membership')
      .select(['id', 'garden_id', 'profile_id', 'role'])
      .where('garden_id', '=', gardenId)
      .where('profile_id', '=', profileId)
      .where('state', '=', 'active')
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      gardenId: row.garden_id,
      profileId: row.profile_id,
      role: row.role as GardenRole,
    };
  }

  async insertOwner(id: Uuid, gardenId: Uuid, profileId: Uuid, now: Date): Promise<void> {
    await this.db
      .insertInto('collaboration.membership')
      .values({
        id,
        garden_id: gardenId,
        profile_id: profileId,
        role: 'owner',
        state: 'active',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  async listMembershipsForProfile(profileId: Uuid): Promise<GardenPartitionMembership[]> {
    const rows = await this.db
      .selectFrom('collaboration.membership')
      .select(['garden_id', 'state'])
      .where('profile_id', '=', profileId)
      .execute();

    return rows.map((row) => ({
      gardenId: row.garden_id,
      state: row.state as GardenMembershipState,
    }));
  }

  async listForGarden(gardenId: Uuid): Promise<MembershipDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.membership')
      .select(['id', 'garden_id', 'profile_id', 'role', 'state', 'updated_at'])
      .where('garden_id', '=', gardenId)
      .orderBy('id', 'asc')
      .execute();

    return rows.map(toMembershipDetail);
  }

  async listDetailsForProfile(profileId: Uuid): Promise<MembershipDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.membership')
      .select(['id', 'garden_id', 'profile_id', 'role', 'state', 'updated_at'])
      .where('profile_id', '=', profileId)
      .orderBy('id', 'asc')
      .execute();

    return rows.map(toMembershipDetail);
  }

  async setState(membershipId: Uuid, state: GardenMembershipState, now: Date): Promise<void> {
    await this.db
      .updateTable('collaboration.membership')
      .set({ state, updated_at: now })
      .where('id', '=', membershipId)
      .execute();
  }
}

function toMembershipDetail(row: {
  id: string;
  garden_id: string;
  profile_id: string;
  role: string;
  state: string;
  updated_at: Date;
}): MembershipDetail {
  return {
    id: row.id,
    gardenId: row.garden_id,
    profileId: row.profile_id,
    role: row.role as GardenRole,
    state: row.state as GardenMembershipState,
    updatedAt: row.updated_at,
  };
}
