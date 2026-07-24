import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { MediaRepository } from '../application/media-repository.js';
import type { MediaProcessingState, MediaUploadState } from '../domain/media-lifecycle.js';
import type {
  MediaClass,
  MediaRecord,
  MediaSensitivityClassification,
} from '../domain/media-record.js';

interface MediaRecordRowLike {
  id: string;
  garden_id: string | null;
  uploaded_by_profile_id: string;
  media_class: string;
  display_filename: string;
  declared_content_type: string;
  verified_content_type: string | null;
  declared_byte_size: number;
  verified_byte_size: number | null;
  checksum_sha256: string | null;
  bucket_name: string | null;
  object_key: string | null;
  upload_state: string;
  processing_state: string | null;
  capture_session_id: string | null;
  sensitivity_classification: string;
  retention_deadline_at: Date | null;
  derived_from_media_id: string | null;
  transformation_version: number | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

function toMediaRecord(row: MediaRecordRowLike): MediaRecord {
  return {
    id: row.id,
    gardenId: row.garden_id,
    uploadedByProfileId: row.uploaded_by_profile_id,
    mediaClass: row.media_class as MediaClass,
    displayFilename: row.display_filename,
    declaredContentType: row.declared_content_type,
    verifiedContentType: row.verified_content_type,
    declaredByteSize: row.declared_byte_size,
    verifiedByteSize: row.verified_byte_size,
    checksumSha256: row.checksum_sha256,
    bucketName: row.bucket_name,
    objectKey: row.object_key,
    uploadState: row.upload_state as MediaUploadState,
    processingState: row.processing_state as MediaProcessingState | null,
    captureSessionId: row.capture_session_id,
    sensitivityClassification: row.sensitivity_classification as MediaSensitivityClassification,
    retentionDeadlineAt: row.retention_deadline_at,
    derivedFromMediaId: row.derived_from_media_id,
    transformationVersion: row.transformation_version,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyMediaRepository implements MediaRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(record: MediaRecord): Promise<void> {
    await this.db
      .insertInto('media.media_record')
      .values({
        id: record.id,
        garden_id: record.gardenId,
        uploaded_by_profile_id: record.uploadedByProfileId,
        media_class: record.mediaClass,
        display_filename: record.displayFilename,
        declared_content_type: record.declaredContentType,
        verified_content_type: record.verifiedContentType,
        declared_byte_size: record.declaredByteSize,
        verified_byte_size: record.verifiedByteSize,
        checksum_sha256: record.checksumSha256,
        bucket_name: record.bucketName,
        object_key: record.objectKey,
        upload_state: record.uploadState,
        processing_state: record.processingState,
        capture_session_id: record.captureSessionId,
        sensitivity_classification: record.sensitivityClassification,
        retention_deadline_at: record.retentionDeadlineAt,
        derived_from_media_id: record.derivedFromMediaId,
        transformation_version: record.transformationVersion,
        revision: record.revision,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
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

  /** Mirrors `KyselyPlantRepository.update`'s exact revision-guarded shape. */
  async update(record: MediaRecord, expectedRevision: number): Promise<boolean> {
    const result = await this.db
      .updateTable('media.media_record')
      .set({
        garden_id: record.gardenId,
        media_class: record.mediaClass,
        display_filename: record.displayFilename,
        declared_content_type: record.declaredContentType,
        verified_content_type: record.verifiedContentType,
        declared_byte_size: record.declaredByteSize,
        verified_byte_size: record.verifiedByteSize,
        checksum_sha256: record.checksumSha256,
        bucket_name: record.bucketName,
        object_key: record.objectKey,
        upload_state: record.uploadState,
        processing_state: record.processingState,
        capture_session_id: record.captureSessionId,
        sensitivity_classification: record.sensitivityClassification,
        retention_deadline_at: record.retentionDeadlineAt,
        derived_from_media_id: record.derivedFromMediaId,
        transformation_version: record.transformationVersion,
        revision: record.revision,
        updated_at: record.updatedAt,
      })
      .where('id', '=', record.id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) === 1n;
  }
}
