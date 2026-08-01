import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  ClientUpdateItemDetail,
  ClientUpdateItemInsertInput,
  ClientUpdateItemKind,
  ClientUpdateItemRepository,
  PublicationMediaRole,
} from '../application/client-update-item-repository.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

interface ClientUpdateItemRowShape {
  id: string;
  client_update_id: string;
  kind: string;
  occurred_at: Date;
  source_work_log_id: string | null;
  description: string | null;
  media_record_id: string | null;
  media_role: string | null;
  caption: string | null;
  source_observation_id: string | null;
  created_at: Date;
}

function toDetail(row: ClientUpdateItemRowShape): ClientUpdateItemDetail {
  return {
    id: row.id,
    clientUpdateId: row.client_update_id,
    kind: row.kind as ClientUpdateItemKind,
    occurredAt: row.occurred_at,
    sourceWorkLogId: row.source_work_log_id,
    description: row.description,
    mediaRecordId: row.media_record_id,
    mediaRole: row.media_role as PublicationMediaRole | null,
    caption: row.caption,
    sourceObservationId: row.source_observation_id,
    createdAt: row.created_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'client_update_id',
  'kind',
  'occurred_at',
  'source_work_log_id',
  'description',
  'media_record_id',
  'media_role',
  'caption',
  'source_observation_id',
  'created_at',
] as const;

export class KyselyClientUpdateItemRepository implements ClientUpdateItemRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(input: ClientUpdateItemInsertInput): Promise<void> {
    await this.db
      .insertInto('collaboration.client_update_item')
      .values({
        id: input.id,
        client_update_id: input.clientUpdateId,
        kind: input.kind,
        occurred_at: input.occurredAt,
        source_work_log_id: input.kind === 'work_log' ? input.sourceWorkLogId : null,
        description: input.kind === 'media' ? null : input.description,
        media_record_id: input.kind === 'media' ? input.mediaRecordId : null,
        media_role: input.kind === 'media' ? input.mediaRole : null,
        caption: input.kind === 'media' ? input.caption : null,
        source_observation_id: input.kind === 'observation' ? input.sourceObservationId : null,
        created_at: input.now,
      })
      .execute();
  }

  async findByIdAndClientUpdate(
    id: Uuid,
    clientUpdateId: Uuid,
  ): Promise<ClientUpdateItemDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.client_update_item')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .where('client_update_id', '=', clientUpdateId)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async remove(id: Uuid): Promise<void> {
    await this.db.deleteFrom('collaboration.client_update_item').where('id', '=', id).execute();
  }

  async listForClientUpdate(clientUpdateId: Uuid): Promise<readonly ClientUpdateItemDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.client_update_item')
      .select(SELECTED_COLUMNS)
      .where('client_update_id', '=', clientUpdateId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toDetail);
  }
}
