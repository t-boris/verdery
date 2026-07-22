/**
 * Kysely row types for the platform schema: idempotency, outbox, sync change,
 * and audit tables.
 *
 * These tables have no owning business module — they are the cross-cutting
 * write-path infrastructure every module's use cases depend on, matching
 * `platform.idempotency_record` / `outbox_event` / `sync_change` /
 * `audit_event` in migrations/1784736116655_identity-and-gardens-baseline.sql.
 *
 * Source: architecture/data-and-geospatial-design.md, section
 * "3. Schema Ownership" ("Platform | Idempotency records, outbox, sync
 * changes, operational metadata").
 */

import type { Generated } from 'kysely';

/**
 * Plain `unknown`, not Kysely's `JSONColumnType<T>` wrapper: every write to a
 * jsonb column in this service calls `JSON.stringify` itself rather than
 * relying on Kysely's own Insert-side JSON serialization (`string` is
 * trivially assignable to `unknown`), and every read is passed straight
 * through to callers as opaque data. `JSONColumnType<T>` also requires `T
 * extends object | null`, which the callers' own `unknown`-typed inputs
 * (`OutboxEventInput.payload`, and so on) do not satisfy.
 */
export type JsonValue = unknown;

export interface IdempotencyRecordRow {
  actor_profile_id: string;
  operation: string;
  idempotency_key: string;
  request_fingerprint: string;
  response_status_code: number;
  response_body: JsonValue;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface OutboxEventRow {
  id: string;
  event_type: string;
  event_version: Generated<number>;
  aggregate_type: string;
  aggregate_id: string;
  payload: JsonValue;
  trace_id: string | null;
  occurred_at: Generated<Date>;
  published_at: Date | null;
  publish_attempts: Generated<number>;
}

export interface SyncChangeRow {
  // Represented as a JS number, not the string node-postgres would otherwise
  // return for bigint: a change sequence advancing by one per accepted
  // mutation cannot reach Number.MAX_SAFE_INTEGER (2^53) within the service's
  // realistic lifetime. Unpopulated in Phase 2; see the migration's comment
  // on this table.
  sequence: Generated<number>;
  garden_id: string | null;
  record_id: string;
  record_type: string;
  operation: 'upsert' | 'delete';
  record_revision: number;
  committed_at: Generated<Date>;
}

export interface AuditEventRow {
  id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_profile_id: string | null;
  actor_type: Generated<'user' | 'system' | 'administrator'>;
  // No `| null` here: JsonValue is `unknown`, which already subsumes null.
  details: JsonValue;
  occurred_at: Generated<Date>;
}

export interface PlatformDatabaseSchema {
  'platform.idempotency_record': IdempotencyRecordRow;
  'platform.outbox_event': OutboxEventRow;
  'platform.sync_change': SyncChangeRow;
  'platform.audit_event': AuditEventRow;
}
