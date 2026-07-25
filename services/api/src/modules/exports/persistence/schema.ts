import type { Generated } from 'kysely';

/**
 * Row types for the `exports` schema (1786300000000_exports-baseline.sql).
 * `byte_size` is `bigint`, read as a JS number through the global bigint
 * type parser (`platform/database/pg-bigint-parser.ts`) — the
 * `media.media_record` byte-column note.
 */
export interface ExportRequestRow {
  id: string;
  requester_profile_id: string;
  scope: string;
  garden_id: string | null;
  include_media: boolean;
  format_version: string;
  state: Generated<string>;
  session_credential_kind: string;
  session_authenticated_at: Date;
  boundary_at: Date | null;
  attempt_count: Generated<number>;
  output_media_id: string;
  package_bucket_name: string;
  package_object_key: string;
  output_checksum_sha256: string | null;
  failure_code: string | null;
  expires_at: Date | null;
  completed_at: Date | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ExportSectionCheckpointRow {
  export_request_id: string;
  entry_path: string;
  disposition: string;
  bucket_name: string;
  object_key: string;
  content_type: string;
  checksum_sha256: string;
  byte_size: number;
  completed_at: Date;
}

export interface ExportsDatabaseSchema {
  'exports.export_request': ExportRequestRow;
  'exports.export_section_checkpoint': ExportSectionCheckpointRow;
}
