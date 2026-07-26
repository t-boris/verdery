import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenLifecycleState } from '../domain/garden.js';
import type { GardenRole } from '../domain/garden-role.js';
import type {
  GardenAccess,
  GardenMembershipState,
  GardenPartitionMembership,
  MembershipDetail,
  MembershipRepository,
} from '../application/membership-repository.js';

export class KyselyMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /**
   * An INNER JOIN to the garden, not a second query: authorization decides on
   * the role and the lifecycle state together, so they are read together, at
   * one instant.
   *
   * The join also does real work on its own. `collaboration.membership` has no
   * foreign key to `gardens_mapping.garden` (the revocation tombstone must
   * outlive the garden it names — see `GardenMembershipState`), so a membership
   * row can genuinely outlive its garden; an inner join is what turns that into
   * the `null` the caller conceals as `notFound`, instead of authorizing a
   * caller against a garden that no longer exists.
   *
   * Crossing from `collaboration` into `gardens_mapping` here is the same
   * deliberate Phase-2 consolidation `membership-repository.ts` already
   * records: this module owns both tables today. When a real Collaboration
   * module takes `membership` over, this join is the seam — the port stays
   * `findGardenAccess`, and the composition of the two facts moves with it.
   */
  async findGardenAccess(gardenId: Uuid, profileId: Uuid): Promise<GardenAccess | null> {
    const row = await this.db
      .selectFrom('collaboration.membership')
      .innerJoin(
        'gardens_mapping.garden',
        'gardens_mapping.garden.id',
        'collaboration.membership.garden_id',
      )
      .select([
        'collaboration.membership.id as id',
        'collaboration.membership.garden_id as garden_id',
        'collaboration.membership.profile_id as profile_id',
        'collaboration.membership.role as role',
        'gardens_mapping.garden.lifecycle_state as lifecycle_state',
      ])
      .where('collaboration.membership.garden_id', '=', gardenId)
      .where('collaboration.membership.profile_id', '=', profileId)
      .where('collaboration.membership.state', '=', 'active')
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      membership: {
        id: row.id,
        gardenId: row.garden_id,
        profileId: row.profile_id,
        role: row.role as GardenRole,
      },
      gardenLifecycleState: row.lifecycle_state as GardenLifecycleState,
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
