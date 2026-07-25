/**
 * Kysely implementation of `ExportRequestRepository` (P8-EXPORT-01).
 * Revision-guarded updates (`WHERE revision = expected - 1`), the
 * `KyselyMediaRepository.update` precedent; the checkpoint write is a
 * delete-then-insert pair inside the caller's transaction so the stored
 * set is always one snapshot attempt's.
 */

import type { Kysely, Selectable } from 'kysely';
import type { ExportSectionDisposition } from '@verdery/api-contracts';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ExportRequest, ExportRequestState, ExportScope } from '../domain/export-request.js';
import type {
  ExportRequestRepository,
  ExportSectionCheckpointRecord,
  NewExportSectionCheckpoint,
} from '../application/export-request-repository.js';
import type { ExportRequestRow } from './schema.js';

const ACTIVE_STATES: readonly string[] = ['requested', 'running'];

function toExportRequest(row: Selectable<ExportRequestRow>): ExportRequest {
  return {
    id: row.id,
    requesterProfileId: row.requester_profile_id,
    scope: row.scope as ExportScope,
    gardenId: row.garden_id,
    includeMedia: row.include_media,
    formatVersion: row.format_version,
    state: row.state as ExportRequestState,
    sessionCredentialKind: row.session_credential_kind,
    sessionAuthenticatedAt: row.session_authenticated_at,
    boundaryAt: row.boundary_at,
    attemptCount: row.attempt_count,
    outputMediaId: row.output_media_id,
    packageBucketName: row.package_bucket_name,
    packageObjectKey: row.package_object_key,
    outputChecksumSha256: row.output_checksum_sha256,
    failureCode: row.failure_code,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyExportRequestRepository implements ExportRequestRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(request: ExportRequest): Promise<void> {
    await this.db
      .insertInto('exports.export_request')
      .values({
        id: request.id,
        requester_profile_id: request.requesterProfileId,
        scope: request.scope,
        garden_id: request.gardenId,
        include_media: request.includeMedia,
        format_version: request.formatVersion,
        state: request.state,
        session_credential_kind: request.sessionCredentialKind,
        session_authenticated_at: request.sessionAuthenticatedAt,
        boundary_at: request.boundaryAt,
        attempt_count: request.attemptCount,
        output_media_id: request.outputMediaId,
        package_bucket_name: request.packageBucketName,
        package_object_key: request.packageObjectKey,
        output_checksum_sha256: request.outputChecksumSha256,
        failure_code: request.failureCode,
        expires_at: request.expiresAt,
        completed_at: request.completedAt,
        revision: request.revision,
        created_at: request.createdAt,
        updated_at: request.updatedAt,
      })
      .execute();
  }

  async get(id: Uuid): Promise<ExportRequest | null> {
    const row = await this.db
      .selectFrom('exports.export_request')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toExportRequest(row);
  }

  async getForRequester(id: Uuid, requesterProfileId: Uuid): Promise<ExportRequest | null> {
    const row = await this.db
      .selectFrom('exports.export_request')
      .selectAll()
      .where('id', '=', id)
      .where('requester_profile_id', '=', requesterProfileId)
      .executeTakeFirst();

    return row === undefined ? null : toExportRequest(row);
  }

  async findActiveForRequester(requesterProfileId: Uuid): Promise<ExportRequest | null> {
    const row = await this.db
      .selectFrom('exports.export_request')
      .selectAll()
      .where('requester_profile_id', '=', requesterProfileId)
      .where('state', 'in', ACTIVE_STATES)
      .executeTakeFirst();

    return row === undefined ? null : toExportRequest(row);
  }

  async update(request: ExportRequest): Promise<boolean> {
    const result = await this.db
      .updateTable('exports.export_request')
      .set({
        state: request.state,
        boundary_at: request.boundaryAt,
        attempt_count: request.attemptCount,
        output_checksum_sha256: request.outputChecksumSha256,
        failure_code: request.failureCode,
        expires_at: request.expiresAt,
        completed_at: request.completedAt,
        revision: request.revision,
        updated_at: request.updatedAt,
      })
      .where('id', '=', request.id)
      .where('revision', '=', request.revision - 1)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async listCheckpoints(exportRequestId: Uuid): Promise<readonly ExportSectionCheckpointRecord[]> {
    const rows = await this.db
      .selectFrom('exports.export_section_checkpoint')
      .selectAll()
      .where('export_request_id', '=', exportRequestId)
      .orderBy('entry_path')
      .execute();

    return rows.map((row) => ({
      exportRequestId: row.export_request_id,
      entryPath: row.entry_path,
      disposition: row.disposition as ExportSectionDisposition,
      bucketName: row.bucket_name,
      objectKey: row.object_key,
      contentType: row.content_type,
      checksumSha256: row.checksum_sha256,
      byteSize: row.byte_size,
      completedAt: row.completed_at,
    }));
  }

  async replaceCheckpoints(
    exportRequestId: Uuid,
    sections: readonly NewExportSectionCheckpoint[],
    now: Date,
  ): Promise<void> {
    await this.db
      .deleteFrom('exports.export_section_checkpoint')
      .where('export_request_id', '=', exportRequestId)
      .execute();

    if (sections.length === 0) {
      return;
    }

    await this.db
      .insertInto('exports.export_section_checkpoint')
      .values(
        sections.map((section) => ({
          export_request_id: exportRequestId,
          entry_path: section.entryPath,
          disposition: section.disposition,
          bucket_name: section.bucketName,
          object_key: section.objectKey,
          content_type: section.contentType,
          checksum_sha256: section.checksumSha256,
          byte_size: section.byteSize,
          completed_at: now,
        })),
      )
      .execute();
  }
}
