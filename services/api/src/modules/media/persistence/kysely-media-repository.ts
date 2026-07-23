import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRepository } from '../application/media-repository.js';
import type { MediaRecord } from '../domain/media-record.js';

interface MediaRecordRowLike {
  id: string;
  storage_reference: string;
  mime_type: string;
  uploaded_by_profile_id: string;
  created_at: Date;
}

function toMediaRecord(row: MediaRecordRowLike): MediaRecord {
  return {
    id: row.id,
    storageReference: row.storage_reference,
    mimeType: row.mime_type,
    uploadedByProfileId: row.uploaded_by_profile_id,
    createdAt: row.created_at,
  };
}

export class KyselyMediaRepository implements MediaRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(record: MediaRecord): Promise<void> {
    await this.db
      .insertInto('media.media_record')
      .values({
        id: record.id,
        storage_reference: record.storageReference,
        mime_type: record.mimeType,
        uploaded_by_profile_id: record.uploadedByProfileId,
        created_at: record.createdAt,
      })
      .execute();
  }

  async get(id: Uuid): Promise<MediaRecord | null> {
    const row = await this.db
      .selectFrom('media.media_record')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toMediaRecord(row);
  }
}
