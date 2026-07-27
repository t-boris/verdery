import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PublisherGrantDetail,
  PublisherGrantInsertInput,
  PublisherGrantRepository,
  PublisherGrantState,
} from '../application/publisher-grant-repository.js';

interface PublisherGrantRowShape {
  id: string;
  engagement_id: string;
  profile_id: string;
  state: string;
  granted_by_profile_id: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by_profile_id: string | null;
  created_at: Date;
}

function toDetail(row: PublisherGrantRowShape): PublisherGrantDetail {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    profileId: row.profile_id,
    state: row.state as PublisherGrantState,
    grantedByProfileId: row.granted_by_profile_id,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    revokedByProfileId: row.revoked_by_profile_id,
    createdAt: row.created_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'engagement_id',
  'profile_id',
  'state',
  'granted_by_profile_id',
  'granted_at',
  'revoked_at',
  'revoked_by_profile_id',
  'created_at',
] as const;

export class KyselyPublisherGrantRepository implements PublisherGrantRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(input: PublisherGrantInsertInput): Promise<void> {
    await this.db
      .insertInto('collaboration.publisher_grant')
      .values({
        id: input.id,
        engagement_id: input.engagementId,
        profile_id: input.profileId,
        state: 'active',
        granted_by_profile_id: input.grantedByProfileId,
        granted_at: input.now,
        revoked_at: null,
        revoked_by_profile_id: null,
        created_at: input.now,
      })
      .execute();
  }

  async findActiveByEngagementAndProfile(
    engagementId: Uuid,
    profileId: Uuid,
  ): Promise<PublisherGrantDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.publisher_grant')
      .select(SELECTED_COLUMNS)
      .where('engagement_id', '=', engagementId)
      .where('profile_id', '=', profileId)
      .where('state', '=', 'active')
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async findLatestByEngagementAndProfile(
    engagementId: Uuid,
    profileId: Uuid,
  ): Promise<PublisherGrantDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.publisher_grant')
      .select(SELECTED_COLUMNS)
      .where('engagement_id', '=', engagementId)
      .where('profile_id', '=', profileId)
      .orderBy('granted_at', 'desc')
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async lockById(id: Uuid): Promise<PublisherGrantDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.publisher_grant')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async revoke(id: Uuid, now: Date, revokedByProfileId: Uuid): Promise<void> {
    await this.db
      .updateTable('collaboration.publisher_grant')
      .set({ state: 'revoked', revoked_at: now, revoked_by_profile_id: revokedByProfileId })
      .where('id', '=', id)
      .execute();
  }

  async listForEngagement(engagementId: Uuid): Promise<readonly PublisherGrantDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.publisher_grant')
      .select(SELECTED_COLUMNS)
      .where('engagement_id', '=', engagementId)
      .orderBy('granted_at', 'desc')
      .execute();

    return rows.map(toDetail);
  }
}
