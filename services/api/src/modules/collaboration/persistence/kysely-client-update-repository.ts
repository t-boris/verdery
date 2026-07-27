import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  ClientUpdateDetail,
  ClientUpdateInsertInput,
  ClientUpdateRepository,
} from '../application/client-update-repository.js';
import type { PublicationState } from '../domain/publication-state.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

interface ClientUpdateRowShape {
  id: string;
  engagement_id: string;
  garden_id: string;
  state: string;
  title: string;
  summary: string | null;
  revision: number;
  created_by_profile_id: string;
  submitted_at: Date | null;
  published_at: Date | null;
  published_by_profile_id: string | null;
  withdrawn_at: Date | null;
  withdrawn_by_profile_id: string | null;
  withdrawn_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDetail(row: ClientUpdateRowShape): ClientUpdateDetail {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    gardenId: row.garden_id,
    state: row.state as PublicationState,
    title: row.title,
    summary: row.summary,
    revision: row.revision,
    createdByProfileId: row.created_by_profile_id,
    submittedAt: row.submitted_at,
    publishedAt: row.published_at,
    publishedByProfileId: row.published_by_profile_id,
    withdrawnAt: row.withdrawn_at,
    withdrawnByProfileId: row.withdrawn_by_profile_id,
    withdrawnReason: row.withdrawn_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'engagement_id',
  'garden_id',
  'state',
  'title',
  'summary',
  'revision',
  'created_by_profile_id',
  'submitted_at',
  'published_at',
  'published_by_profile_id',
  'withdrawn_at',
  'withdrawn_by_profile_id',
  'withdrawn_reason',
  'created_at',
  'updated_at',
] as const;

export class KyselyClientUpdateRepository implements ClientUpdateRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(input: ClientUpdateInsertInput): Promise<void> {
    await this.db
      .insertInto('collaboration.client_update')
      .values({
        id: input.id,
        engagement_id: input.engagementId,
        garden_id: input.gardenId,
        state: 'internal_draft',
        title: input.title,
        summary: null,
        revision: 1,
        created_by_profile_id: input.createdByProfileId,
        submitted_at: null,
        published_at: null,
        published_by_profile_id: null,
        withdrawn_at: null,
        withdrawn_by_profile_id: null,
        withdrawn_reason: null,
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
  }

  async findById(id: Uuid): Promise<ClientUpdateDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.client_update')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async findByIdAndEngagement(id: Uuid, engagementId: Uuid): Promise<ClientUpdateDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.client_update')
      .select(SELECTED_COLUMNS)
      .where('id', '=', id)
      .where('engagement_id', '=', engagementId)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async update(record: ClientUpdateDetail, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .updateTable('collaboration.client_update')
      .set({
        state: record.state,
        title: record.title,
        summary: record.summary,
        revision: record.revision,
        submitted_at: record.submittedAt,
        published_at: record.publishedAt,
        published_by_profile_id: record.publishedByProfileId,
        withdrawn_at: record.withdrawnAt,
        withdrawn_by_profile_id: record.withdrawnByProfileId,
        withdrawn_reason: record.withdrawnReason,
        updated_at: record.updatedAt,
      })
      .where('id', '=', record.id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) === 1n;
  }

  async listForEngagement(engagementId: Uuid): Promise<readonly ClientUpdateDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.client_update')
      .select(SELECTED_COLUMNS)
      .where('engagement_id', '=', engagementId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toDetail);
  }
}
