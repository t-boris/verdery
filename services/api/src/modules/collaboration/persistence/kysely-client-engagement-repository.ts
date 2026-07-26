import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ClientEngagementDetail,
  ClientEngagementInsertInput,
  ClientEngagementRepository,
  StewardshipPolicy,
} from '../application/client-engagement-repository.js';
import type { ClientEngagementState } from '../domain/client-engagement-state.js';

interface ClientEngagementRowShape {
  id: string;
  garden_id: string;
  service_organization_id: string | null;
  state: string;
  stewardship_policy: string;
  client_notifications_enabled: boolean;
  created_by_profile_id: string;
  activated_at: Date | null;
  ended_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDetail(row: ClientEngagementRowShape): ClientEngagementDetail {
  return {
    id: row.id,
    gardenId: row.garden_id,
    serviceOrganizationId: row.service_organization_id,
    state: row.state as ClientEngagementState,
    stewardshipPolicy: row.stewardship_policy as StewardshipPolicy,
    clientNotificationsEnabled: row.client_notifications_enabled,
    createdByProfileId: row.created_by_profile_id,
    activatedAt: row.activated_at,
    endedAt: row.ended_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'garden_id',
  'service_organization_id',
  'state',
  'stewardship_policy',
  'client_notifications_enabled',
  'created_by_profile_id',
  'activated_at',
  'ended_at',
  'revoked_at',
  'revoked_reason',
  'created_at',
  'updated_at',
] as const;

export class KyselyClientEngagementRepository implements ClientEngagementRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(input: ClientEngagementInsertInput): Promise<void> {
    await this.db
      .insertInto('collaboration.client_engagement')
      .values({
        id: input.id,
        garden_id: input.gardenId,
        service_organization_id: input.serviceOrganizationId,
        state: 'draft',
        stewardship_policy: input.stewardshipPolicy,
        client_notifications_enabled: input.clientNotificationsEnabled,
        created_by_profile_id: input.createdByProfileId,
        activated_at: null,
        ended_at: null,
        revoked_at: null,
        revoked_reason: null,
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
  }

  async findById(id: Uuid): Promise<ClientEngagementDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.client_engagement')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async lockById(id: Uuid): Promise<ClientEngagementDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.client_engagement')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async activate(id: Uuid, now: Date): Promise<void> {
    await this.db
      .updateTable('collaboration.client_engagement')
      .set({ state: 'active', activated_at: now, updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async end(id: Uuid, now: Date): Promise<void> {
    await this.db
      .updateTable('collaboration.client_engagement')
      .set({ state: 'ended', ended_at: now, updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async revoke(id: Uuid, now: Date, reason: string | null): Promise<void> {
    await this.db
      .updateTable('collaboration.client_engagement')
      .set({ state: 'revoked', revoked_at: now, revoked_reason: reason, updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async listForOrganization(organizationId: Uuid): Promise<ClientEngagementDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.client_engagement')
      .select(SELECTED_COLUMNS)
      .where('service_organization_id', '=', organizationId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toDetail);
  }

  async listForGarden(gardenId: Uuid): Promise<ClientEngagementDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.client_engagement')
      .select(SELECTED_COLUMNS)
      .where('garden_id', '=', gardenId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toDetail);
  }
}
