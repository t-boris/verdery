import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AccountState } from '../domain/account-state.js';
import type { Profile } from '../domain/profile.js';
import type { ProfileRepository } from '../application/profile-repository.js';
import type { ProfileRow } from './schema.js';

/**
 * `Selectable<ProfileRow>`, not `ProfileRow` itself: Kysely's `Generated<T>`
 * wrapper only unwraps to `T` through this utility (or through a query's own
 * inferred result type). A manually-annotated `ProfileRow` parameter keeps
 * `revision` typed as `Generated<number>`, not `number`.
 */
function toProfile(row: Selectable<ProfileRow>): Profile {
  return {
    id: row.id,
    firebaseUid: row.firebase_uid,
    accountState: row.account_state as AccountState,
    locale: row.locale,
    timeZone: row.time_zone,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyProfileRepository implements ProfileRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findByFirebaseUid(firebaseUid: string): Promise<Profile | null> {
    const row = await this.db
      .selectFrom('identity_access.profile')
      .selectAll()
      .where('firebase_uid', '=', firebaseUid)
      .executeTakeFirst();

    return row === undefined ? null : toProfile(row);
  }

  async findById(id: Uuid): Promise<Profile | null> {
    const row = await this.db
      .selectFrom('identity_access.profile')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toProfile(row);
  }

  async insert(profile: Profile): Promise<void> {
    await this.db
      .insertInto('identity_access.profile')
      .values({
        id: profile.id,
        firebase_uid: profile.firebaseUid,
        account_state: profile.accountState,
        locale: profile.locale,
        time_zone: profile.timeZone,
        revision: profile.revision,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt,
      })
      .execute();
  }
}
