import type { Generated } from 'kysely';

/**
 * `garden_id`, `verified_content_type`, `verified_byte_size`,
 * `checksum_sha256`, `bucket_name`, `object_key`, `processing_state`,
 * `capture_session_id`, `retention_deadline_at`, and `derived_from_media_id`
 * are genuinely nullable — see `domain/media-record.ts`'s own field-by-field
 * doc comments for why each one is. `declared_byte_size`/`verified_byte_size`
 * are `bigint` in the migration, read as JS numbers via the global bigint
 * type parser `platform/database/pg-bigint-parser.ts` documents and every
 * integration test that touches them imports explicitly.
 *
 * Source: migrations/1785100000000_media-lifecycle-and-quotas.sql.
 */
export interface MediaRecordRow {
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
  upload_state: Generated<string>;
  processing_state: string | null;
  capture_session_id: string | null;
  sensitivity_classification: string;
  retention_deadline_at: Date | null;
  derived_from_media_id: string | null;
  transformation_version: number | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * `reserved_bytes` is `bigint` in the migration — same JS-number-via-global-
 * parser note as `MediaRecordRow`'s own byte-size columns above.
 *
 * Source: migrations/1785100000000_media-lifecycle-and-quotas.sql.
 */
export interface QuotaReservationRow {
  id: string;
  scope_kind: string;
  scope_garden_id: string | null;
  scope_profile_id: string | null;
  media_id: string;
  reserved_bytes: number;
  state: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * `input_checksums`/`output_objects`/`result_summary`/`quality_diagnostics`/
 * `resource_metrics` are `jsonb` in the migration, read/written as plain
 * `unknown` here — `persistence/kysely-processing-job-repository.ts` owns the
 * narrow cast to `domain/processing-job.ts`'s own typed shapes, the same
 * "the row type stays honestly untyped where Postgres itself is untyped"
 * precedent this module already sets for jsonb-backed columns elsewhere.
 *
 * Source: migrations/1785200000000_media-processing-jobs.sql.
 */
export interface ProcessingJobRow {
  id: string;
  media_id: string;
  job_kind: Generated<string>;
  processor_config_version: Generated<string>;
  state: Generated<string>;
  attempt: Generated<number>;
  input_checksums: Generated<unknown>;
  // `unknown` already subsumes `null` — Postgres returns SQL NULL as JS
  // `null` for these nullable jsonb columns, which `unknown` accepts without
  // a redundant explicit union member.
  output_objects: unknown;
  result_summary: unknown;
  quality_diagnostics: unknown;
  resource_metrics: unknown;
  outcome_code: string | null;
  trace_id: string | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  queued_at: Date | null;
  completed_at: Date | null;
  updated_at: Generated<Date>;
}

export interface MediaDatabaseSchema {
  'media.media_record': MediaRecordRow;
  'media.quota_reservation': QuotaReservationRow;
  'media.processing_job': ProcessingJobRow;
}
