/**
 * SELECT-only cross-schema implementation of `GardenRecipientSource`
 * (P7-NOTIF-01): active memberships joined to their profiles' account
 * state and time zone — the `KyselyEvaluationGardenSource` narrow-read-port
 * precedent. Reads the same rows `GardenAuthorization` authorizes against,
 * through Kysely's typed schema, never another module's private
 * repository implementation.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AccountState } from '../../identity-access/public.js';
import type {
  GardenRecipient,
  GardenRecipientSource,
} from '../application/garden-recipient-source.js';

export class KyselyGardenRecipientSource implements GardenRecipientSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listActiveMembers(gardenId: Uuid): Promise<readonly GardenRecipient[]> {
    const rows = await this.db
      .selectFrom('collaboration.membership')
      .innerJoin(
        'identity_access.profile',
        'identity_access.profile.id',
        'collaboration.membership.profile_id',
      )
      .select([
        'collaboration.membership.profile_id as profile_id',
        'identity_access.profile.account_state as account_state',
        'identity_access.profile.time_zone as time_zone',
      ])
      .where('collaboration.membership.garden_id', '=', gardenId)
      .where('collaboration.membership.state', '=', 'active')
      .orderBy('collaboration.membership.profile_id')
      .execute();

    return rows.map((row) => ({
      profileId: row.profile_id,
      // Constrained by the profile table's own CHECK; only trusted
      // migrations and this codebase write it.
      accountState: row.account_state as AccountState,
      timeZone: row.time_zone,
    }));
  }

  async findActiveMember(gardenId: Uuid, profileId: Uuid): Promise<GardenRecipient | null> {
    const row = await this.db
      .selectFrom('collaboration.membership')
      .innerJoin(
        'identity_access.profile',
        'identity_access.profile.id',
        'collaboration.membership.profile_id',
      )
      .select([
        'collaboration.membership.profile_id as profile_id',
        'identity_access.profile.account_state as account_state',
        'identity_access.profile.time_zone as time_zone',
      ])
      .where('collaboration.membership.garden_id', '=', gardenId)
      .where('collaboration.membership.profile_id', '=', profileId)
      .where('collaboration.membership.state', '=', 'active')
      .executeTakeFirst();

    return row === undefined
      ? null
      : {
          profileId: row.profile_id,
          accountState: row.account_state as AccountState,
          timeZone: row.time_zone,
        };
  }

  async findProfileRecipient(profileId: Uuid): Promise<GardenRecipient | null> {
    const row = await this.db
      .selectFrom('identity_access.profile')
      .select(['id', 'account_state', 'time_zone'])
      .where('id', '=', profileId)
      .executeTakeFirst();

    return row === undefined
      ? null
      : {
          profileId: row.id,
          accountState: row.account_state as AccountState,
          timeZone: row.time_zone,
        };
  }
}
