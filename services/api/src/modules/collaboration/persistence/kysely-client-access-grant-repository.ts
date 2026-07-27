import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientAccessGrantRepository } from '../application/client-access-grant-repository.js';
import type { ClientAccessGrant } from '../domain/client-access-grant.js';
import type { ClientAccessGrantState } from '../domain/client-access-grant-state.js';

interface ClientAccessGrantRowShape {
  id: string;
  engagement_id: string;
  client_profile_id: string | null;
  invited_email: string | null;
  token_hash: string | null;
  expires_at: Date | null;
  state: string;
  granted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

function toDomain(row: ClientAccessGrantRowShape): ClientAccessGrant {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    clientProfileId: row.client_profile_id,
    invitedEmail: row.invited_email,
    tokenHash: row.token_hash,
    state: row.state as ClientAccessGrantState,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'engagement_id',
  'client_profile_id',
  'invited_email',
  'token_hash',
  'expires_at',
  'state',
  'granted_at',
  'revoked_at',
  'created_at',
] as const;

const OUTSTANDING_STATES = ['pending', 'active'] as const;

export class KyselyClientAccessGrantRepository implements ClientAccessGrantRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(grant: ClientAccessGrant): Promise<void> {
    await this.db
      .insertInto('collaboration.client_access_grant')
      .values({
        id: grant.id,
        engagement_id: grant.engagementId,
        client_profile_id: grant.clientProfileId,
        invited_email: grant.invitedEmail,
        token_hash: grant.tokenHash,
        expires_at: grant.expiresAt,
        state: grant.state,
        granted_at: grant.grantedAt,
        revoked_at: grant.revokedAt,
        created_at: grant.createdAt,
      })
      .execute();
  }

  async findByTokenHash(tokenHash: string): Promise<ClientAccessGrant | null> {
    const row = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select(SELECTED_COLUMNS)
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    return row === undefined ? null : toDomain(row);
  }

  async findByIdAndEngagement(id: Uuid, engagementId: Uuid): Promise<ClientAccessGrant | null> {
    const row = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .where('engagement_id', '=', engagementId)
      .executeTakeFirst();

    return row === undefined ? null : toDomain(row);
  }

  async lockById(id: Uuid): Promise<ClientAccessGrant | null> {
    const row = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? null : toDomain(row);
  }

  async hasOutstandingGrantForEmail(engagementId: Uuid, invitedEmail: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select('id')
      .where('engagement_id', '=', engagementId)
      .where('invited_email', '=', invitedEmail)
      .where('state', 'in', OUTSTANDING_STATES)
      .executeTakeFirst();

    return row !== undefined;
  }

  async update(grant: ClientAccessGrant): Promise<void> {
    await this.db
      .updateTable('collaboration.client_access_grant')
      .set({
        client_profile_id: grant.clientProfileId,
        invited_email: grant.invitedEmail,
        state: grant.state,
        granted_at: grant.grantedAt,
        revoked_at: grant.revokedAt,
      })
      .where('id', '=', grant.id)
      .execute();
  }

  async listForEngagement(engagementId: Uuid): Promise<readonly ClientAccessGrant[]> {
    const rows = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select(SELECTED_COLUMNS)
      .where('engagement_id', '=', engagementId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toDomain);
  }

  async findActiveForProfileAndEngagement(
    clientProfileId: Uuid,
    engagementId: Uuid,
  ): Promise<ClientAccessGrant | null> {
    const row = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select(SELECTED_COLUMNS)
      .where('engagement_id', '=', engagementId)
      .where('client_profile_id', '=', clientProfileId)
      .where('state', '=', 'active')
      .executeTakeFirst();

    return row === undefined ? null : toDomain(row);
  }

  async listActiveForProfile(clientProfileId: Uuid): Promise<readonly ClientAccessGrant[]> {
    const rows = await this.db
      .selectFrom('collaboration.client_access_grant')
      .select(SELECTED_COLUMNS)
      .where('client_profile_id', '=', clientProfileId)
      .where('state', '=', 'active')
      .orderBy('granted_at', 'desc')
      .execute();

    return rows.map(toDomain);
  }
}
