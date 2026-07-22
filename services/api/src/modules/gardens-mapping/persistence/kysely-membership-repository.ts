import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRole } from '../domain/garden-role.js';
import type { Membership, MembershipRepository } from '../application/membership-repository.js';

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
}
